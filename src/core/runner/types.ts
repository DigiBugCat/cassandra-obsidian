/**
 * Runner protocol types. Defines the HTTP + WS contract between
 * Cassandra and the claude-agent-runner orchestrator.
 */

// --- Session Management ---

export interface RunnerSessionRequest {
  name?: string;
  workspace?: string;
  vault?: string;
  message?: string;
  model?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  maxTurns?: number;
  thinking?: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  additionalDirectories?: string[];
  compactInstructions?: string;
  permissionMode?: string;
  allowedPaths?: string[];
}

export interface RunnerSessionInfo {
  session_id: string;
  name?: string;
  status: string;
  model: string;
  created_at: string;
  last_activity: string;
  message_count: number;
  source: { type: string; workspace?: string };
}

export interface RunnerSessionDetail extends RunnerSessionInfo {
  context_tokens?: number;
  compact_count?: number;
  error?: string;
}

export interface RunnerForkRequest {
  resumeAt?: string;
  message?: string;
  model?: string;
}

// --- Content Blocks ---

export type UserContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

// --- Client → Server Frames ---

export interface SendFrame {
  type: 'send';
  session_id: string;
  message: string;
  content?: UserContentBlock[];
  model?: string;
  max_turns?: number;
  max_thinking_tokens?: number;
  request_id?: string;
}

export interface SteerFrame {
  type: 'steer';
  session_id: string;
  message: string;
  content?: UserContentBlock[];
  mode?: 'steer' | 'fork_and_steer';
  model?: string;
  max_turns?: number;
  max_thinking_tokens?: number;
  compact?: boolean;
  compact_instructions?: string;
  request_id?: string;
}

export interface SetOptionsFrame {
  type: 'set_options';
  session_id: string;
  model?: string;
  max_thinking_tokens?: number;
  compact_instructions?: string;
  request_id?: string;
}

export interface PermissionResponseFrame {
  type: 'permission_response';
  session_id: string;
  tool_use_id: string;
  behavior: 'allow' | 'deny';
  request_id?: string;
}

// --- Server → Client Frames ---

export interface AckFrame {
  type: 'ack';
  session_id: string;
  ok: boolean;
  error?: string;
  request_id?: string;
}

export interface StatusFrame {
  type: 'status';
  session_id: string;
  status: string;
}

export interface EventFrame {
  type: 'event';
  session_id: string;
  event: RunnerEvent;
  request_id?: string;
}

export interface ContextStateFrame {
  type: 'context_state';
  session_id: string;
  context_tokens: number;
  compacted?: boolean;
}

export interface PermissionRequestFrame {
  type: 'permission_request';
  session_id: string;
  tool_name: string;
  tool_use_id: string;
  input: Record<string, unknown>;
}

export interface CommandsResultFrame {
  type: 'commands_result';
  session_id: string;
  commands: Array<{ name: string; description: string; argumentHint: string }>;
  request_id?: string;
}

export interface ErrorFrame {
  type: 'error';
  session_id?: string;
  error_code?: string;
  message?: string;
}

export type ServerFrame =
  | AckFrame
  | StatusFrame
  | EventFrame
  | ContextStateFrame
  | PermissionRequestFrame
  | CommandsResultFrame
  | ErrorFrame
  | { type: 'pong' }
  | { type: 'subscribed'; session_id: string };

// --- Runner Event (inside EventFrame.event) ---

export interface RunnerEvent {
  type: string;
  uuid?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  [key: string]: any;
}

export interface RunnerSlashCommand {
  name: string;
  description: string;
  argumentHint: string;
}
