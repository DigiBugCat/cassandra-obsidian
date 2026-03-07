export interface TranscriptTextBlock {
  type: 'text';
  text: string;
}

export interface TranscriptToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input?: Record<string, unknown>;
}

export interface TranscriptToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | TranscriptTextBlock[];
  is_error?: boolean;
}

export type TranscriptContentBlock =
  | TranscriptTextBlock
  | TranscriptToolUseBlock
  | TranscriptToolResultBlock;

export interface TranscriptMessage {
  content?: string | TranscriptContentBlock[];
}

export interface TranscriptUserEvent {
  type: 'user';
  uuid?: string;
  message?: TranscriptMessage;
}

export interface TranscriptAssistantEvent {
  type: 'assistant';
  uuid?: string;
  message?: TranscriptMessage;
}

export interface TranscriptEventBase {
  type: string;
  uuid?: string;
  message?: TranscriptMessage;
  [key: string]: unknown;
}

export type TranscriptEvent =
  | TranscriptUserEvent
  | TranscriptAssistantEvent
  | TranscriptEventBase;
