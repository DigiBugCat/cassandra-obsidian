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
  ApprovalCallback,
  AskUserQuestionCallback,
  ChatAgentService,
  EnsureReadyOptions,
  QueryOptions,
} from '../agent';
import { createLogger } from '../logging';
import type {
  ChatMessage,
  ExitPlanModeCallback,
  ImageAttachment,
  StreamEvent,
  TranscriptEvent,
} from '../types';
import { THINKING_BUDGETS } from '../types';
import { RunnerClient } from './RunnerClient';
import { transformRunnerEvent } from './transformRunnerEvent';
import type { PermissionRequestFrame, RunnerEvent, RunnerSessionRequest, UserContentBlock } from './types';

const log = createLogger('RunnerService');

type ReadyListener = (ready: boolean) => void;

export class RunnerService implements ChatAgentService {

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
  private onTitleGeneratedCallback: ((title: string) => void) | null = null;
  private titleGenerated = false;

  // State
  private readyListeners: ReadyListener[] = [];
  private eventCleanups: Array<() => void> = [];
  private pendingResumeAt: string | undefined;
  private currentModel: string | undefined;
  private currentThinkingBudget: string | undefined;
  private currentPermissionMode: string | undefined;
  private pendingReady: Promise<boolean> | null = null;
  private readonly onClientConnected = (): void => {
    if (!this.runnerSessionId) return;
    const wasDisconnected = !this.active;
    this.active = true;
    this.setReady(true);
    if (wasDisconnected) {
      new Notice('Runner reconnected');
    }
  };
  private readonly onClientDisconnected = (): void => {
    if (!this.active) return;
    this.active = false;
    new Notice('Runner disconnected — reconnecting...');
    this.setReady(false);
  };

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
      this.client = new RunnerClient(
        config.settings.runnerUrl || 'https://claude-runner.cassandrasedge.com',
        config.settings.apiKey || undefined,
      );
      this.ownsClient = true;
    }

    this.client.on('connected', this.onClientConnected);
    this.client.on('disconnected', this.onClientDisconnected);
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
    const docBlocks = queryOptions?.documentBlocks ?? [];
    let content: UserContentBlock[] | undefined;
    if ((images && images.length > 0) || docBlocks.length > 0) {
      content = [];
      for (const img of images ?? []) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.data },
        });
      }
      for (const block of docBlocks) {
        content.push(block);
      }
      if (prompt.trim()) {
        content.push({ type: 'text', text: prompt });
      }
    }

    this.applyDynamicOptions();

    // Compute thinking tokens for this send
    const budgetConfig = THINKING_BUDGETS.find(b => b.value === this.config.settings.thinkingBudget);
    const maxThinkingTokens = budgetConfig?.tokens ?? 0;

    const sendOpts = {
      content,
      model: queryOptions?.model || this.currentModel,
      // Always pass thinking tokens so the runner respects the current setting
      maxThinkingTokens: maxThinkingTokens > 0 ? maxThinkingTokens : 0,
    };

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
        this.client.send(this.runnerSessionId, prompt, sendOpts);
      }
    } else {
      this.client.send(this.runnerSessionId, prompt, sendOpts);
    }

    yield { type: 'sdk_user_sent', uuid };

    // Collect assistant text for title generation
    let assistantText = '';
    for await (const event of this.yieldEventsUntilDone()) {
      if (event.type === 'text') assistantText += event.content;
      yield event;
    }

    // Fire background title generation after first response
    if (!this.titleGenerated && this.config.settings.enableAutoTitleGeneration && this.runnerSessionId) {
      this.titleGenerated = true;
      this.client.generateTitle(this.runnerSessionId, prompt, assistantText.substring(0, 500)).then((title) => {
        if (title) this.onTitleGeneratedCallback?.(title);
      }).catch(() => {});
    }
  }

  cancel(): void {
    if (this.runnerSessionId && this.client.isConnected()) {
      this.client.steer(this.runnerSessionId, '', 'steer');
    }
    this.resolveAllQueries();
  }

  cleanup(): void {
    this.detachCurrentSession();
    this.client.removeListener('connected', this.onClientConnected);
    this.client.removeListener('disconnected', this.onClientDisconnected);
    if (this.ownsClient) {
      this.client.disconnect();
    }
  }

  /** Reconnect to the current session. Resumes stopped sessions via the orchestrator. */
  async reconnect(): Promise<boolean> {
    return this.runnerSessionId ? this.attachToSession(this.runnerSessionId) : false;
  }

  resetSession(): void {
    this.detachCurrentSession();
  }

  getSessionId(): string | null {
    return this.runnerSessionId;
  }

  setSessionId(id: string | null, externalContextPaths?: string[]): void {
    if (!id) {
      this.resetSession();
      return;
    }
    void this.attachToSession(id, externalContextPaths);
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
      if (!options?.force && this.runnerSessionId && this.active && this.client.isConnected()) {
        return true;
      }

      const sessionIdToAttach = options?.force ? null : options?.sessionId ?? this.runnerSessionId;
      if (sessionIdToAttach) {
        return this.attachToSession(sessionIdToAttach, options?.externalContextPaths);
      }

      if (!this.client.isConnected()) await this.client.connect();

      // Create session if needed
      const { settings, vaultPath } = this.config;
      const budgetConfig = THINKING_BUDGETS.find(b => b.value === settings.thinkingBudget);
      const additionalDirectories = Array.from(new Set([
        ...settings.persistentExternalContextPaths,
        ...(options?.externalContextPaths ?? []),
      ]));

      const req: RunnerSessionRequest = {
        workspace: settings.runnerVaultName ? undefined : vaultPath,
        vault: settings.runnerVaultName || undefined,
        model: settings.model,
        systemPrompt: settings.systemPrompt || undefined,
        thinking: (budgetConfig?.tokens ?? 0) > 0,
        permissionMode: settings.permissionMode,
        compactInstructions: settings.compactInstructions || undefined,
        allowedPaths: settings.enableVaultRestriction ? [vaultPath] : undefined,
        additionalDirectories: additionalDirectories.length > 0 ? additionalDirectories : undefined,
        mcpServers: this.parseMcpServers(settings.mcpServersJson),
        agentId: settings.agentName || undefined,
      };

      log.info('create_session_request', {
        workspace: req.workspace,
        model: req.model,
        permissionMode: req.permissionMode,
        thinking: req.thinking,
      });
      const result = await this.client.createSession(req);
      this.runnerSessionId = result.session_id;
      log.info('session_created', { session_id: this.runnerSessionId });

      // Snapshot settings at creation so applyDynamicOptions detects subsequent changes
      this.currentModel = settings.model;
      this.currentThinkingBudget = settings.thinkingBudget;
      this.currentPermissionMode = settings.permissionMode;

      this.activateSession(this.runnerSessionId);
      this.onSessionCreatedCallback?.(this.runnerSessionId);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('ensure_ready_failed', { error: msg });
      new Notice(`Runner connection failed: ${msg}`);
      this.detachCurrentSession();
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
  setOnTitleGenerated(callback: ((title: string) => void) | null): void { this.onTitleGeneratedCallback = callback; }

  // ── Slash Commands ─────────────────────────────────────────

  async getCommands(): Promise<{ name: string; description: string; argumentHint: string }[]> {
    if (!this.runnerSessionId || !this.client.isConnected()) return [];
    return this.client.getCommands(this.runnerSessionId);
  }

  // ── Transcript ─────────────────────────────────────────────────────

  async getTranscript(): Promise<TranscriptEvent[]> {
    if (!this.runnerSessionId) return [];
    return this.client.getTranscript(this.runnerSessionId);
  }

  // ── Fork / Resume ──────────────────────────────────────────────────

  suppressTitleGeneration(): void { this.titleGenerated = true; }

  scheduleForkFromUserMessage(uuid: string | undefined): void { this.pendingResumeAt = uuid; }

  setPendingResumeAt(uuid: string | undefined): void { this.scheduleForkFromUserMessage(uuid); }

  rewindToUserMessage(uuid: string): void {
    if (!this.runnerSessionId || !this.client.isConnected()) return;
    this.client.rewind(this.runnerSessionId, uuid);
  }

  async attachToSession(sessionId: string, externalContextPaths?: string[]): Promise<boolean> {
    try {
      if (!this.client.isConnected()) await this.client.connect();

      let targetSessionId = sessionId;
      let status: string;
      try {
        const session = await this.client.getSession(sessionId);
        status = session.status;
      } catch (err) {
        log.info('attach_session_missing', {
          session_id: sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
        this.detachCurrentSession();
        return false;
      }

      if (status === 'stopped' || status === 'error') {
        log.info('attach_resuming_session', { session_id: sessionId, status });
        const resumed = await this.client.resumeSession(sessionId);
        targetSessionId = resumed.session_id;
      }

      this.activateSession(targetSessionId);
      log.info('session_attached', {
        session_id: targetSessionId,
        status,
        externalContextPaths: externalContextPaths?.length ?? 0,
      });
      return true;
    } catch (err) {
      log.warn('attach_session_failed', { session_id: sessionId, error: String(err) });
      this.detachCurrentSession();
      return false;
    }
  }

  async stopRemoteSession(): Promise<void> {
    if (!this.runnerSessionId) return;
    const sessionId = this.runnerSessionId;
    await this.client.stopSession(sessionId);
    if (this.client.isConnected()) {
      this.client.unsubscribe(sessionId);
    }
    this.clearEventHandlers();
    this.resolveAllQueries();
    this.sdkSessionId = null;
    this.pendingResumeAt = undefined;
    this.active = false;
    this.setReady(false);
  }

  async deleteRemoteSession(): Promise<void> {
    if (!this.runnerSessionId) return;
    const sessionId = this.runnerSessionId;
    this.detachCurrentSession();
    await this.client.deleteSession(sessionId);
  }

  // ── Internal ───────────────────────────────────────────────────────

  private activateSession(sessionId: string): void {
    const previousSessionId = this.runnerSessionId;
    if (
      previousSessionId &&
      previousSessionId !== sessionId &&
      this.client.isConnected()
    ) {
      this.client.unsubscribe(previousSessionId);
    }

    this.clearEventHandlers();
    this.runnerSessionId = sessionId;
    this.sdkSessionId = null;
    this.active = true;
    this.setupEventHandlers(sessionId);
    this.client.subscribe(sessionId);
    this.setReady(true);
  }

  private detachCurrentSession(): void {
    const sessionId = this.runnerSessionId;
    if (sessionId && this.client.isConnected()) {
      this.client.unsubscribe(sessionId);
    }
    this.clearEventHandlers();
    this.resolveAllQueries();
    this.runnerSessionId = null;
    this.sdkSessionId = null;
    this.pendingResumeAt = undefined;
    this.active = false;
    this.setReady(false);
  }

  private clearEventHandlers(): void {
    for (const cleanup of this.eventCleanups) cleanup();
    this.eventCleanups = [];
  }

  private setupEventHandlers(sessionId: string): void {
    this.clearEventHandlers();

    const { settings } = this.config;
    let sawStreamText = false;

    const onEvent = (event: RunnerEvent) => {
      if (event.type === 'stream_event') {
        const inner = event.event;
        log.debug('runner_event', {
          type: event.type,
          innerType: inner?.type,
          deltaType: inner?.delta?.type,
          textPreview: inner?.delta?.type === 'text_delta' ? (inner.delta.text as string)?.slice(0, 40) : undefined,
          resolvers: this.queryResolvers.length,
        });
      } else {
        log.debug('runner_event', { type: event.type, subtype: event.subtype, error: event.error, resolvers: this.queryResolvers.length });
      }

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

      if (event.type === 'result' || event.type === 'error') {
        sawStreamText = false;
      }
      if (event.type === 'result') {
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
      sawStreamText = false;
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
