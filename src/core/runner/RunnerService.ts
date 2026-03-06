/**
 * Runner-backed agent service.
 * Implements AgentService by delegating to claude-agent-runner via HTTP + WS.
 *
 * Receives AgentConfig (settings + vaultPath) — no Obsidian plugin dependency.
 * Zero Node.js imports — mobile-safe.
 */

import { Notice } from 'obsidian';

import type {
  AgentBackend,
  AgentConfig,
  AgentService,
  ApprovalCallback,
  AskUserQuestionCallback,
  EnsureReadyOptions,
  QueryOptions,
} from '../agent';
import { createLogger } from '../logging';
import type {
  ChatMessage,
  ExitPlanModeCallback,
  ImageAttachment,
  StreamEvent,
} from '../types';
import { THINKING_BUDGETS } from '../types';
import { RunnerClient } from './RunnerClient';
import { transformRunnerEvent } from './transformRunnerEvent';
import type { PermissionRequestFrame, RunnerEvent, RunnerSessionRequest, UserContentBlock } from './types';

const log = createLogger('RunnerService');

type ReadyListener = (ready: boolean) => void;

export class RunnerService implements AgentService {

  private config: AgentConfig;
  private client: RunnerClient;
  private ownsClient = true;
  private runnerSessionId: string | null = null;
  private sdkSessionId: string | null = null;
  private active = false;

  // Callbacks
  private approvalCallback: ApprovalCallback | null = null;
  private approvalDismisser: (() => void) | null = null;
  private askUserCallback: AskUserQuestionCallback | null = null;
  private exitPlanModeCallback: ExitPlanModeCallback | null = null;
  private permissionModeSyncCallback: ((sdkMode: string) => void) | null = null;
  private onSessionCreatedCallback: ((sessionId: string) => void) | null = null;

  // State
  private readyListeners: ReadyListener[] = [];
  private eventCleanups: Array<() => void> = [];
  private pendingResumeAt: string | undefined;
  private currentModel: string | undefined;
  private currentThinkingBudget: string | undefined;
  private currentPermissionMode: string | undefined;
  private pendingReady: Promise<boolean> | null = null;

  // Active query resolvers
  private queryResolvers: Array<{
    push: (event: StreamEvent) => void;
    done: () => void;
    error: (err: Error) => void;
  }> = [];

  constructor(config: AgentConfig, client?: RunnerClient) {
    this.config = config;

    if (client) {
      this.client = client;
      this.ownsClient = false;
    } else {
      this.client = new RunnerClient(config.settings.runnerUrl || 'http://localhost:9080');
      this.ownsClient = true;
    }

    this.client.on('disconnected', () => {
      if (this.active) {
        new Notice('Runner disconnected — reconnecting...');
        this.setReady(false);
      }
    });
  }

  /** Update config (e.g. when settings change). */
  updateConfig(config: AgentConfig): void {
    this.config = config;
  }

  // ── AgentService ────────────────────────────────────────────────────

  getBackend(): AgentBackend {
    return 'runner';
  }

  async *query(
    prompt: string,
    images?: ImageAttachment[],
    _conversationHistory?: ChatMessage[],
    queryOptions?: QueryOptions,
  ): AsyncGenerator<StreamEvent> {
    if (!this.runnerSessionId) await this.ensureReady();
    if (!this.runnerSessionId) {
      yield { type: 'error', content: 'Runner session not available' };
      yield { type: 'done' };
      return;
    }

    const uuid = crypto.randomUUID();
    yield { type: 'sdk_user_uuid', uuid };

    // Build multimodal content blocks
    let content: UserContentBlock[] | undefined;
    if (images && images.length > 0) {
      content = [];
      for (const img of images) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.data },
        });
      }
      if (prompt.trim()) {
        content.push({ type: 'text', text: prompt });
      }
    }

    this.applyDynamicOptions();

    // Fork if pendingResumeAt is set
    if (this.pendingResumeAt) {
      try {
        const forkResult = await this.client.forkSession(this.runnerSessionId, {
          resumeAt: this.pendingResumeAt,
          message: prompt,
          model: queryOptions?.model || this.currentModel,
        });
        const oldSessionId = this.runnerSessionId;
        this.runnerSessionId = forkResult.session_id;
        this.setupEventHandlers(this.runnerSessionId);
        this.client.subscribe(this.runnerSessionId);
        this.client.unsubscribe(oldSessionId);
        this.pendingResumeAt = undefined;
        log.info('forked_session', { old: oldSessionId, new: this.runnerSessionId });
      } catch (err) {
        log.warn('fork_failed', { error: String(err) });
        this.pendingResumeAt = undefined;
        this.client.send(this.runnerSessionId, prompt, {
          content,
          model: queryOptions?.model || this.currentModel,
        });
      }
    } else {
      this.client.send(this.runnerSessionId, prompt, {
        content,
        model: queryOptions?.model || this.currentModel,
      });
    }

    yield { type: 'sdk_user_sent', uuid };
    yield* this.yieldEventsUntilDone();
  }

  cancel(): void {
    if (this.runnerSessionId && this.client.isConnected()) {
      this.client.steer(this.runnerSessionId, '', 'steer');
    }
    this.resolveAllQueries();
  }

  cleanup(): void {
    for (const cleanup of this.eventCleanups) cleanup();
    this.eventCleanups = [];

    if (this.runnerSessionId) {
      this.client.unsubscribe(this.runnerSessionId);
      this.client.deleteSession(this.runnerSessionId).catch(() => {});
      this.runnerSessionId = null;
    }

    if (this.ownsClient) this.client.disconnect();
    this.active = false;
    this.setReady(false);
  }

  /** Reconnect to the current session. Resumes stopped sessions via the orchestrator. */
  async reconnect(): Promise<boolean> {
    if (!this.runnerSessionId) return false;
    const sessionId = this.runnerSessionId;
    try {
      if (!this.client.isConnected()) await this.client.connect();

      // Check session status on the orchestrator
      let status: string;
      try {
        const session = await this.client.getSession(sessionId);
        status = session.status;
      } catch {
        log.info('reconnect_session_not_found', { session_id: sessionId });
        return false;
      }

      // If stopped/error, ask the orchestrator to resume (respawn container with same session ID)
      if (status === 'stopped' || status === 'error') {
        log.info('reconnect_resuming_stopped_session', { session_id: sessionId, status });
        try {
          await this.client.resumeSession(sessionId);
          log.info('reconnect_resume_success', { session_id: sessionId });
        } catch (err) {
          log.warn('reconnect_resume_failed', { session_id: sessionId, error: String(err) });
          return false;
        }
      }

      this.setupEventHandlers(sessionId);
      this.client.subscribe(sessionId);
      this.active = true;
      this.setReady(true);
      log.info('reconnect_success', { session_id: sessionId });
      return true;
    } catch (err) {
      log.warn('reconnect_failed', { session_id: sessionId, error: String(err) });
      return false;
    }
  }

  resetSession(): void {
    if (this.runnerSessionId) {
      this.client.unsubscribe(this.runnerSessionId);
      this.client.deleteSession(this.runnerSessionId).catch(() => {});
    }
    this.runnerSessionId = null;
    this.sdkSessionId = null;
    this.active = false;
    this.setReady(false);
  }

  getSessionId(): string | null {
    return this.runnerSessionId;
  }

  setSessionId(id: string | null, externalContextPaths?: string[]): void {
    if (id === this.runnerSessionId) return;

    if (this.runnerSessionId) {
      this.client.unsubscribe(this.runnerSessionId);
      for (const cleanup of this.eventCleanups) cleanup();
      this.eventCleanups = [];
    }

    this.runnerSessionId = id;
    this.sdkSessionId = null;

    if (id) {
      this.ensureReady({ sessionId: id, externalContextPaths });
    } else {
      this.active = false;
      this.setReady(false);
    }
  }

  isReady(): boolean {
    return this.active && this.client.isConnected();
  }

  onReadyStateChange(listener: ReadyListener): () => void {
    this.readyListeners.push(listener);
    return () => { this.readyListeners = this.readyListeners.filter(l => l !== listener); };
  }

  async ensureReady(options?: EnsureReadyOptions): Promise<boolean> {
    // Coalesce concurrent calls: if ensureReady is already in-flight, wait for it
    if (this.pendingReady) return this.pendingReady;

    this.pendingReady = this.doEnsureReady(options);
    try {
      return await this.pendingReady;
    } finally {
      this.pendingReady = null;
    }
  }

  private async doEnsureReady(options?: EnsureReadyOptions): Promise<boolean> {
    try {
      if (!this.client.isConnected()) await this.client.connect();

      // Re-attach to existing session
      if (!this.runnerSessionId && options?.sessionId) {
        try {
          const session = await this.client.getSession(options.sessionId);
          if (session && session.status !== 'stopped' && session.status !== 'error') {
            this.runnerSessionId = options.sessionId;
            log.info('session_reattached', { session_id: this.runnerSessionId });
          }
        } catch { /* will create new */ }
      }

      // Create session if needed
      if (!this.runnerSessionId || options?.force) {
        const { settings, vaultPath } = this.config;
        const budgetConfig = THINKING_BUDGETS.find(b => b.value === settings.thinkingBudget);

        const req: RunnerSessionRequest = {
          workspace: settings.runnerVaultName ? undefined : vaultPath,
          vault: settings.runnerVaultName || undefined,
          model: settings.model,
          systemPrompt: settings.systemPrompt || undefined,
          thinking: (budgetConfig?.tokens ?? 0) > 0,
          permissionMode: settings.permissionMode,
          compactInstructions: settings.compactInstructions || undefined,
          allowedPaths: settings.enableVaultRestriction ? [vaultPath] : undefined,
          additionalDirectories: settings.persistentExternalContextPaths.length > 0
            ? settings.persistentExternalContextPaths : undefined,
          mcpServers: this.parseMcpServers(settings.mcpServersJson),
          agentId: settings.agentName || undefined,
        };

        log.info('create_session_request', { workspace: req.workspace, model: req.model, permissionMode: req.permissionMode, thinking: req.thinking });
        const result = await this.client.createSession(req);
        this.runnerSessionId = result.session_id;
        log.info('session_created', { session_id: this.runnerSessionId });
        this.onSessionCreatedCallback?.(this.runnerSessionId);
      }

      this.setupEventHandlers(this.runnerSessionId!);
      this.client.subscribe(this.runnerSessionId!);

      this.active = true;
      this.setReady(true);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('ensure_ready_failed', { error: msg });
      new Notice(`Runner connection failed: ${msg}`);
      this.setReady(false);
      return false;
    }
  }

  // ── Callbacks ───────────────────────────────────────────────────────

  setApprovalCallback(callback: ApprovalCallback | null): void { this.approvalCallback = callback; }
  setApprovalDismisser(dismisser: (() => void) | null): void { this.approvalDismisser = dismisser; }
  setAskUserQuestionCallback(callback: AskUserQuestionCallback | null): void { this.askUserCallback = callback; }
  setExitPlanModeCallback(callback: ExitPlanModeCallback | null): void { this.exitPlanModeCallback = callback; }
  setPermissionModeSyncCallback(callback: ((sdkMode: string) => void) | null): void { this.permissionModeSyncCallback = callback; }
  setOnSessionCreated(callback: ((sessionId: string) => void) | null): void { this.onSessionCreatedCallback = callback; }

  // ── Slash Commands ─────────────────────────────────────────

  async getCommands(): Promise<{ name: string; description: string; argumentHint: string }[]> {
    if (!this.runnerSessionId || !this.client.isConnected()) return [];
    return this.client.getCommands(this.runnerSessionId);
  }

  // ── Fork / Resume ──────────────────────────────────────────────────

  setPendingResumeAt(uuid: string | undefined): void { this.pendingResumeAt = uuid; }

  // ── Internal ───────────────────────────────────────────────────────

  private setupEventHandlers(sessionId: string): void {
    for (const cleanup of this.eventCleanups) cleanup();
    this.eventCleanups = [];

    const { settings } = this.config;
    let sawStreamText = false;

    const onEvent = (event: RunnerEvent) => {
      log.debug('runner_event', { type: event.type, subtype: event.subtype, error: event.error, resolvers: this.queryResolvers.length });

      if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
        this.sdkSessionId = event.session_id;
        if (event.permissionMode && this.permissionModeSyncCallback) {
          this.permissionModeSyncCallback(event.permissionMode);
        }
      }

      // Track streaming text for dedup
      if (event.type === 'stream_event') {
        const inner = event.event;
        if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta') {
          sawStreamText = true;
        }
      }

      const transformed = transformRunnerEvent(event, {
        intendedModel: settings.model,
        customContextLimits: settings.customContextLimits,
      });

      for (const streamEvent of transformed) {
        // Skip duplicate text from assistant if already streamed
        if (sawStreamText && event.type === 'assistant' && streamEvent.type === 'text') continue;
        if (sawStreamText && event.type === 'assistant' && streamEvent.type === 'subagent_event' && (streamEvent as any).event?.type === 'text') continue;

        if (streamEvent.type === 'tool_use' && streamEvent.name === 'EnterPlanMode' && this.permissionModeSyncCallback) {
          this.permissionModeSyncCallback('plan');
        }

        for (const resolver of this.queryResolvers) resolver.push(streamEvent);
      }

      if (event.type === 'result') {
        sawStreamText = false;
        for (const resolver of this.queryResolvers) resolver.done();
      }
    };

    const onStatus = (status: string) => {
      log.debug('status', { session_id: sessionId, status });
    };

    const onPermission = async (req: PermissionRequestFrame) => {
      if (!this.approvalCallback) {
        this.client.respondToPermission(sessionId, req.tool_use_id, 'allow');
        return;
      }

      try {
        if (req.tool_name === 'AskUserQuestion' && this.askUserCallback) {
          const answer = await this.askUserCallback(req.input);
          this.client.respondToPermission(sessionId, req.tool_use_id, answer ? 'allow' : 'deny');
          return;
        }

        if (req.tool_name === 'ExitPlanMode' && this.exitPlanModeCallback) {
          const decision = await this.exitPlanModeCallback(req.input);
          if (decision === null || decision.type === 'feedback') {
            this.client.respondToPermission(sessionId, req.tool_use_id, 'deny');
          } else {
            this.client.respondToPermission(sessionId, req.tool_use_id, 'allow');
          }
          return;
        }

        const decision = await this.approvalCallback(
          req.tool_name,
          req.input,
          `${req.tool_name}: ${JSON.stringify(req.input).slice(0, 200)}`,
        );
        this.client.respondToPermission(
          sessionId,
          req.tool_use_id,
          decision === 'allow' || decision === 'allow-always' ? 'allow' : 'deny',
        );
      } catch {
        this.client.respondToPermission(sessionId, req.tool_use_id, 'deny');
      }
    };

    const onError = (err: any) => {
      log.warn('session_error', { session_id: sessionId, error: err.message });
      for (const resolver of this.queryResolvers) {
        resolver.error(new Error(err.message || 'Session error'));
      }
    };

    this.client.on(`event:${sessionId}`, onEvent);
    this.client.on(`status:${sessionId}`, onStatus);
    this.client.on(`permission_request:${sessionId}`, onPermission);
    this.client.on(`error:${sessionId}`, onError);

    this.eventCleanups.push(
      () => this.client.removeListener(`event:${sessionId}`, onEvent),
      () => this.client.removeListener(`status:${sessionId}`, onStatus),
      () => this.client.removeListener(`permission_request:${sessionId}`, onPermission),
      () => this.client.removeListener(`error:${sessionId}`, onError),
    );
  }

  private async *yieldEventsUntilDone(): AsyncGenerator<StreamEvent> {
    const buffer: StreamEvent[] = [];
    let resolveNext: (() => void) | null = null;
    let done = false;
    let error: Error | null = null;

    const resolver = {
      push: (event: StreamEvent) => { buffer.push(event); resolveNext?.(); },
      done: () => { done = true; resolveNext?.(); },
      error: (err: Error) => { error = err; resolveNext?.(); },
    };

    this.queryResolvers.push(resolver);

    try {
      while (true) {
        while (buffer.length > 0) yield buffer.shift()!;
        if (done) break;
        if (error) { yield { type: 'error', content: (error as Error).message }; break; }
        await new Promise<void>((resolve) => { resolveNext = resolve; });
        resolveNext = null;
      }
    } finally {
      this.queryResolvers = this.queryResolvers.filter(r => r !== resolver);
    }

    yield { type: 'done' };
  }

  private resolveAllQueries(): void {
    for (const resolver of this.queryResolvers) resolver.done();
  }

  private applyDynamicOptions(): void {
    if (!this.runnerSessionId || !this.client.isConnected()) return;

    const { settings } = this.config;
    const opts: { model?: string; maxThinkingTokens?: number; permissionMode?: string } = {};
    let changed = false;

    if (settings.model !== this.currentModel && this.currentModel !== undefined) {
      opts.model = settings.model;
      changed = true;
    }
    this.currentModel = settings.model;

    if (settings.thinkingBudget !== this.currentThinkingBudget && this.currentThinkingBudget !== undefined) {
      const budgetConfig = THINKING_BUDGETS.find(b => b.value === settings.thinkingBudget);
      opts.maxThinkingTokens = budgetConfig?.tokens ?? 0;
      changed = true;
    }
    this.currentThinkingBudget = settings.thinkingBudget;

    if (settings.permissionMode !== this.currentPermissionMode && this.currentPermissionMode !== undefined) {
      opts.permissionMode = settings.permissionMode;
      changed = true;
    }
    this.currentPermissionMode = settings.permissionMode;

    if (changed) this.client.setOptions(this.runnerSessionId, opts);
  }

  private parseMcpServers(json: string): RunnerSessionRequest['mcpServers'] | undefined {
    if (!json?.trim()) return undefined;
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
      log.warn('mcp_servers_invalid_format', { reason: 'must be an object' });
    } catch (err) {
      log.warn('mcp_servers_parse_error', { error: String(err) });
    }
    return undefined;
  }

  private setReady(ready: boolean): void {
    for (const listener of this.readyListeners) {
      try { listener(ready); } catch { /* ignore */ }
    }
  }
}
