/**
 * Backend-agnostic agent events. Universal contract between agent backends
 * and the UI layer. No backend-specific fields.
 */

import type { UsageInfo } from './chat';

// ── Core Agent Events ────────────────────────────────────────────────

export interface AgentTextEvent { type: 'text'; content: string }
export interface AgentThinkingEvent { type: 'thinking'; content: string }
export interface AgentToolUseEvent { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
export interface AgentToolInputUpdateEvent { type: 'tool_input_update'; id: string; input: Record<string, unknown> }
export interface AgentToolResultEvent { type: 'tool_result'; id: string; content: string; isError?: boolean; meta?: unknown }
export interface AgentUsageEvent { type: 'usage'; usage: UsageInfo; sessionId?: string | null }
export interface AgentErrorEvent { type: 'error'; content: string }
export interface AgentBlockedEvent { type: 'blocked'; content: string }
export interface AgentDoneEvent { type: 'done' }

export type AgentEvent =
  | AgentTextEvent
  | AgentThinkingEvent
  | AgentToolUseEvent
  | AgentToolInputUpdateEvent
  | AgentToolResultEvent
  | AgentUsageEvent
  | AgentErrorEvent
  | AgentBlockedEvent
  | AgentDoneEvent;

// ── Subagent Routing ─────────────────────────────────────────────────

export interface SubagentRoutedEvent {
  type: 'subagent_event';
  parentToolUseId: string;
  event: AgentEvent;
}

// ── Hook Events ──────────────────────────────────────────────────────

export type HookEvent =
  | { type: 'hook_started'; hookId: string; hookName: string; hookEvent: string }
  | { type: 'hook_progress'; hookId: string; hookName: string; hookEvent: string; output: string }
  | { type: 'hook_response'; hookId: string; hookName: string; hookEvent: string; output: string; stdout?: string; stderr?: string; exitCode?: number; outcome: 'success' | 'error' | 'cancelled' };

// ── Session Events ───────────────────────────────────────────────────

export type SessionEvent =
  | { type: 'compact_boundary' }
  | { type: 'sdk_user_uuid'; uuid: string }
  | { type: 'sdk_user_sent'; uuid: string }
  | { type: 'sdk_assistant_uuid'; uuid: string };

// ── Full Stream Event (returned by AgentService.query()) ─────────────

export type StreamEvent =
  | AgentEvent
  | SubagentRoutedEvent
  | HookEvent
  | SessionEvent;
