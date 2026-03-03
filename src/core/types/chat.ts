/**
 * Chat and conversation type definitions.
 */

import type { SubagentInfo, SubagentMode, ToolCallInfo } from './tools';

/** Fork origin reference. */
export interface ForkSource {
  sessionId: string;
  resumeAt: string;
}

/** Supported image media types. */
export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** Image attachment metadata. */
export interface ImageAttachment {
  id: string;
  name: string;
  mediaType: ImageMediaType;
  data: string;
  width?: number;
  height?: number;
  size: number;
  source: 'file' | 'paste' | 'drop';
}

/** Content block for preserving streaming order in messages. */
export type ContentBlock =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; toolId: string }
  | { type: 'thinking'; content: string; durationSeconds?: number }
  | { type: 'subagent'; subagentId: string; mode?: SubagentMode }
  | { type: 'compact_boundary' };

/** Chat message with content, tool calls, and attachments. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  displayContent?: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
  contentBlocks?: ContentBlock[];
  currentNote?: string;
  images?: ImageAttachment[];
  isInterrupt?: boolean;
  durationSeconds?: number;
  sdkUserUuid?: string;
  sdkAssistantUuid?: string;
}

/** Persisted conversation. */
export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastResponseAt?: number;
  sessionId: string | null;
  runnerSessionId?: string;
  messages: ChatMessage[];
  currentNote?: string;
  externalContextPaths?: string[];
  usage?: UsageInfo;
  titleGenerationStatus?: 'pending' | 'success' | 'failed';
  subagentData?: Record<string, SubagentInfo>;
  resumeSessionAt?: string;
  forkSource?: ForkSource;
  threadFolderId?: string | null;
  threadPinned?: boolean;
  threadArchived?: boolean;
}

/** Lightweight conversation metadata. */
export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastResponseAt?: number;
  messageCount: number;
  preview: string;
  titleGenerationStatus?: 'pending' | 'success' | 'failed';
  threadFolderId?: string | null;
  threadPinned?: boolean;
  threadArchived?: boolean;
}

/** Context window usage information. */
export interface UsageInfo {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  contextWindow: number;
  contextTokens: number;
  percentage: number;
}
