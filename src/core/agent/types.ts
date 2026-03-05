/**
 * Agent service contracts — the DI boundary between backends and UI.
 *
 * Services receive AgentConfig (not the plugin) so they're testable
 * and swappable without importing Obsidian.
 */

import type {
  CassandraSettings,
  ChatMessage,
  ExitPlanModeCallback,
  ImageAttachment,
  StreamEvent,
} from '../types';

/** Minimal config that agent services need. Avoids coupling to the full plugin. */
export interface AgentConfig {
  settings: CassandraSettings;
  vaultPath: string;
  vaultName?: string;
}

/** Options for a single query. */
export interface QueryOptions {
  model?: string;
}

/** Options for ensuring the service is ready. */
export interface EnsureReadyOptions {
  sessionId?: string;
  externalContextPaths?: string[];
  force?: boolean;
}

/** User approval callback. */
export type ApprovalCallback = (
  toolName: string,
  input: Record<string, unknown>,
  summary: string,
) => Promise<'allow' | 'allow-always' | 'deny'>;

/** AskUserQuestion callback. */
export type AskUserQuestionCallback = (
  input: Record<string, unknown>,
) => Promise<string | null>;

/** Agent backend identifier. */
export type AgentBackend = 'runner' | 'sdk';

/**
 * Core agent service interface. Every backend (runner, SDK) implements this.
 * UI code depends only on this interface, never on a concrete backend.
 */
export interface AgentService {
  getBackend(): AgentBackend;

  query(
    prompt: string,
    images?: ImageAttachment[],
    conversationHistory?: ChatMessage[],
    queryOptions?: QueryOptions,
  ): AsyncGenerator<StreamEvent>;

  cancel(): void;
  cleanup(): void;
  resetSession(): void;

  getSessionId(): string | null;
  setSessionId(id: string | null, externalContextPaths?: string[]): void;

  isReady(): boolean;
  onReadyStateChange(listener: (ready: boolean) => void): () => void;
  ensureReady(options?: EnsureReadyOptions): Promise<boolean>;

  setApprovalCallback(callback: ApprovalCallback | null): void;
  setApprovalDismisser(dismisser: (() => void) | null): void;
  setAskUserQuestionCallback(callback: AskUserQuestionCallback | null): void;
  setExitPlanModeCallback?(callback: ExitPlanModeCallback | null): void;
  setPermissionModeSyncCallback?(callback: ((sdkMode: string) => void) | null): void;
  setOnSessionCreated?(callback: ((sessionId: string) => void) | null): void;
}
