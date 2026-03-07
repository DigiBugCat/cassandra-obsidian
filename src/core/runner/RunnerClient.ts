/**
 * HTTP + WebSocket client for the claude-agent-runner orchestrator.
 * Zero Node.js dependencies — uses Obsidian's requestUrl + browser WebSocket.
 */

import { EventEmitter } from 'events';
import { requestUrl } from 'obsidian';

import { createLogger } from '../logging';
import type {
  CommandsResultFrame,
  ContextStateFrame,
  ErrorFrame,
  EventFrame,
  PermissionRequestFrame,
  RunnerForkRequest,
  RunnerSessionDetail,
  RunnerSessionRequest,
  RunnerSlashCommand,
  RunnerTranscriptEvent,
  ServerFrame,
  StatusFrame,
  UserContentBlock,
} from './types';

const log = createLogger('RunnerClient');

export interface SendOpts {
  content?: UserContentBlock[];
  model?: string;
  maxTurns?: number;
  maxThinkingTokens?: number;
}

export interface SteerOpts extends SendOpts {
  compact?: boolean;
  compactInstructions?: string;
}

export interface CfAccessCredentials {
  clientId: string;
  clientSecret: string;
}

export class RunnerClient extends EventEmitter {
  private baseUrl: string;
  private wsUrl: string;
  private cfAccess: CfAccessCredentials | null;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private requestCounter = 0;
  private activeSubscriptions = new Set<string>();
  private intentionalDisconnect = false;

  constructor(baseUrl: string = 'http://localhost:9080', cfAccess?: CfAccessCredentials) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/ws';
    this.cfAccess = cfAccess?.clientId && cfAccess?.clientSecret ? cfAccess : null;
  }

  /** Build headers with CF Access credentials if configured. */
  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.cfAccess) {
      h['CF-Access-Client-Id'] = this.cfAccess.clientId;
      h['CF-Access-Client-Secret'] = this.cfAccess.clientSecret;
    }
    return h;
  }

  // --- HTTP ---

  async createSession(req: RunnerSessionRequest): Promise<{ session_id: string }> {
    const resp = await requestUrl({
      url: `${this.baseUrl}/sessions`,
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(req),
    });
    if (resp.status >= 400) {
      throw new Error(`Failed to create session: ${resp.json?.message || `HTTP ${resp.status}`}`);
    }
    return resp.json;
  }

  async deleteSession(id: string): Promise<void> {
    const resp = await requestUrl({ url: `${this.baseUrl}/sessions/${id}`, method: 'DELETE', headers: this.headers() });
    if (resp.status >= 400) {
      throw new Error(`Failed to delete session: ${resp.json?.message || `HTTP ${resp.status}`}`);
    }
  }

  async stopSession(id: string): Promise<void> {
    const resp = await requestUrl({
      url: `${this.baseUrl}/sessions/${id}/stop`,
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: '{}',
    });
    if (resp.status >= 400) {
      throw new Error(`Failed to stop session: ${resp.json?.message || `HTTP ${resp.status}`}`);
    }
  }

  async getSession(id: string): Promise<RunnerSessionDetail> {
    const resp = await requestUrl({ url: `${this.baseUrl}/sessions/${id}`, method: 'GET', headers: this.headers() });
    if (resp.status >= 400) throw new Error(`Session not found: ${id}`);
    return resp.json;
  }

  async resumeSession(id: string): Promise<{ session_id: string; resumed: boolean }> {
    const resp = await requestUrl({
      url: `${this.baseUrl}/sessions/${id}/resume`,
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: '{}',
    });
    if (resp.status >= 400) {
      throw new Error(`Failed to resume session: ${resp.json?.message || `HTTP ${resp.status}`}`);
    }
    return resp.json;
  }

  async forkSession(id: string, req: RunnerForkRequest): Promise<{ session_id: string }> {
    const resp = await requestUrl({
      url: `${this.baseUrl}/sessions/${id}/fork`,
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(req),
    });
    if (resp.status >= 400) {
      throw new Error(`Failed to fork session: ${resp.json?.message || `HTTP ${resp.status}`}`);
    }
    return resp.json;
  }

  async getTranscript(id: string): Promise<RunnerTranscriptEvent[]> {
    const resp = await requestUrl({
      url: `${this.baseUrl}/sessions/${id}/transcript?format=json`,
      method: 'GET',
      headers: this.headers(),
    });
    if (resp.status >= 400) {
      throw new Error(`Failed to get transcript: ${resp.json?.message || `HTTP ${resp.status}`}`);
    }
    return (resp.json?.events ?? []) as RunnerTranscriptEvent[];
  }

  async compactSession(id: string, customInstructions?: string): Promise<void> {
    const resp = await requestUrl({
      url: `${this.baseUrl}/sessions/${id}/context/compact`,
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(customInstructions ? { custom_instructions: customInstructions } : {}),
    });
    if (resp.status >= 400) {
      throw new Error(`Failed to compact session: ${resp.json?.message || `HTTP ${resp.status}`}`);
    }
  }

  async generateTitle(id: string, userMessage: string, assistantMessage?: string): Promise<string> {
    const resp = await requestUrl({
      url: `${this.baseUrl}/sessions/${id}/generate-title`,
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        userMessage,
        assistantMessage,
      }),
    });
    if (resp.status >= 400) {
      throw new Error(`Failed to generate title: ${resp.json?.message || `HTTP ${resp.status}`}`);
    }
    return resp.json?.title ?? '';
  }

  async suggestFolder(
    id: string,
    title: string,
    preview: string,
    folders: string[],
  ): Promise<{ type: 'existing' | 'new'; folderName: string }> {
    const resp = await requestUrl({
      url: `${this.baseUrl}/sessions/${id}/suggest-folder`,
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        title,
        preview,
        folders,
      }),
    });
    if (resp.status >= 400) {
      throw new Error(`Failed to suggest folder: ${resp.json?.message || `HTTP ${resp.status}`}`);
    }
    return resp.json;
  }

  // --- WebSocket ---

  connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();

    return new Promise((resolve, reject) => {
      this.intentionalDisconnect = false;

      try {
        // Browser WebSocket doesn't support custom headers — pass CF Access as query params
        let wsUrl = this.wsUrl;
        if (this.cfAccess) {
          const sep = wsUrl.includes('?') ? '&' : '?';
          wsUrl += `${sep}CF-Access-Client-Id=${encodeURIComponent(this.cfAccess.clientId)}&CF-Access-Client-Secret=${encodeURIComponent(this.cfAccess.clientSecret)}`;
        }
        this.ws = new WebSocket(wsUrl);
      } catch (err) {
        reject(new Error(`Failed to connect to runner: ${err}`));
        return;
      }
      const socket = this.ws;

      const onOpen = () => {
        log.info('connected', { url: this.wsUrl });
        socket.removeEventListener('error', onError);
        this.pingInterval = setInterval(() => {
          if (this.ws === socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);
        this.emit('connected');
        resolve();
      };

      const onError = () => {
        socket.removeEventListener('open', onOpen);
        reject(new Error('WebSocket connection failed'));
      };

      socket.addEventListener('open', onOpen, { once: true });
      socket.addEventListener('error', onError, { once: true });

      socket.addEventListener('message', (event: MessageEvent) => {
        try {
          this.handleFrame(JSON.parse(event.data));
        } catch {
          log.warn('invalid_frame', { data: String(event.data).slice(0, 200) });
        }
      });

      socket.addEventListener('close', () => {
        const shouldReconnect = !this.intentionalDisconnect;
        log.info('disconnected', { intentional: this.intentionalDisconnect });
        this.clearSocketState(socket);
        this.emit('disconnected');
        if (shouldReconnect) {
          this.scheduleReconnect();
        }
      });
    });
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.clearSocketState(ws);
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close();
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // --- WS Commands ---

  subscribe(sessionId: string): void {
    this.activeSubscriptions.add(sessionId);
    this.sendFrame({ type: 'subscribe', session_id: sessionId, request_id: this.nextRequestId() });
  }

  unsubscribe(sessionId: string): void {
    this.activeSubscriptions.delete(sessionId);
    this.sendFrame({ type: 'unsubscribe', session_id: sessionId });
  }

  send(sessionId: string, message: string, opts?: SendOpts): string {
    const requestId = this.nextRequestId();
    this.sendFrame({
      type: 'send',
      session_id: sessionId,
      message,
      ...(opts?.content ? { content: opts.content } : {}),
      ...(opts?.model ? { model: opts.model } : {}),
      ...(opts?.maxTurns ? { max_turns: opts.maxTurns } : {}),
      ...(opts?.maxThinkingTokens !== undefined ? { max_thinking_tokens: opts.maxThinkingTokens } : {}),
      request_id: requestId,
    });
    return requestId;
  }

  steer(sessionId: string, message: string, mode: 'steer' | 'fork_and_steer', opts?: SteerOpts): string {
    const requestId = this.nextRequestId();
    this.sendFrame({
      type: 'steer',
      session_id: sessionId,
      message,
      mode,
      ...(opts?.content ? { content: opts.content } : {}),
      ...(opts?.model ? { model: opts.model } : {}),
      ...(opts?.maxTurns ? { max_turns: opts.maxTurns } : {}),
      ...(opts?.maxThinkingTokens !== undefined ? { max_thinking_tokens: opts.maxThinkingTokens } : {}),
      ...(opts?.compact ? { compact: opts.compact } : {}),
      ...(opts?.compactInstructions ? { compact_instructions: opts.compactInstructions } : {}),
      request_id: requestId,
    });
    return requestId;
  }

  compact(sessionId: string, instructions?: string): void {
    this.sendFrame({
      type: 'compact',
      session_id: sessionId,
      ...(instructions ? { custom_instructions: instructions } : {}),
      request_id: this.nextRequestId(),
    });
  }

  rewind(sessionId: string, userMessageUuid: string): void {
    this.sendFrame({
      type: 'rewind',
      session_id: sessionId,
      user_message_uuid: userMessageUuid,
      request_id: this.nextRequestId(),
    });
  }

  setOptions(sessionId: string, opts: { model?: string; maxThinkingTokens?: number; compactInstructions?: string; permissionMode?: string }): void {
    this.sendFrame({
      type: 'set_options',
      session_id: sessionId,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.maxThinkingTokens !== undefined ? { max_thinking_tokens: opts.maxThinkingTokens } : {}),
      ...(opts.compactInstructions ? { compact_instructions: opts.compactInstructions } : {}),
      ...(opts.permissionMode ? { permission_mode: opts.permissionMode } : {}),
      request_id: this.nextRequestId(),
    });
  }

  respondToPermission(sessionId: string, toolUseId: string, behavior: 'allow' | 'deny'): void {
    this.sendFrame({
      type: 'permission_response',
      session_id: sessionId,
      tool_use_id: toolUseId,
      behavior,
      request_id: this.nextRequestId(),
    });
  }

  async getCommands(sessionId: string): Promise<RunnerSlashCommand[]> {
    const requestId = this.nextRequestId();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.removeListener(`commands_result:${requestId}`, handler);
        resolve([]);
      }, 10000);
      const handler = (commands: RunnerSlashCommand[]) => {
        clearTimeout(timeout);
        resolve(commands);
      };
      this.once(`commands_result:${requestId}`, handler);
      this.sendFrame({ type: 'get_commands', session_id: sessionId, request_id: requestId });
    });
  }

  // --- Internal ---

  private handleFrame(frame: ServerFrame): void {
    switch (frame.type) {
      case 'pong': break;
      case 'ack':
        if (!frame.ok) {
          log.warn('ack_error', { session_id: frame.session_id, error: frame.error });
          // Propagate failed acks as session errors so streaming state cleans up
          if (frame.session_id) {
            this.emit(`error:${frame.session_id}`, { message: frame.error || 'Request failed' });
          }
        }
        this.emit(`ack:${frame.request_id}`, frame);
        break;
      case 'subscribed':
        log.info('subscribed', { session_id: frame.session_id });
        this.emit(`subscribed:${frame.session_id}`);
        break;
      case 'event':
        this.emit(`event:${(frame as EventFrame).session_id}`, (frame as EventFrame).event);
        break;
      case 'status':
        this.emit(`status:${(frame as StatusFrame).session_id}`, (frame as StatusFrame).status);
        break;
      case 'context_state':
        this.emit(`context_state:${(frame as ContextStateFrame).session_id}`, frame);
        break;
      case 'permission_request':
        this.emit(`permission_request:${(frame as PermissionRequestFrame).session_id}`, frame);
        break;
      case 'commands_result':
        this.emit(`commands_result:${(frame as CommandsResultFrame).request_id}`, (frame as CommandsResultFrame).commands);
        break;
      case 'error': {
        const ef = frame as ErrorFrame;
        log.warn('server_error', { session_id: ef.session_id, code: ef.error_code, message: ef.message });
        if (ef.session_id) this.emit(`error:${ef.session_id}`, ef);
        break;
      }
    }
  }

  private sendFrame(frame: Record<string, any>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      log.warn('send_while_disconnected', { frame_type: frame.type });
      return;
    }
    this.ws.send(JSON.stringify(frame));
  }

  private nextRequestId(): string {
    return `r${++this.requestCounter}`;
  }

  private clearSocketState(socket?: WebSocket | null): void {
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    if (!socket || this.ws === socket) {
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().then(() => {
        for (const sessionId of this.activeSubscriptions) {
          this.sendFrame({ type: 'subscribe', session_id: sessionId, request_id: this.nextRequestId() });
        }
      }).catch((err) => log.warn('reconnect_failed', { error: String(err) }));
    }, 3000);
  }
}
