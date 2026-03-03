/**
 * Transforms runner WS events into Cassandra StreamEvents.
 * Pure function — no side effects, no Node.js deps.
 */

import type { StreamEvent, UsageInfo } from '../types';
import type { RunnerEvent } from './types';

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'haiku': 200000,
  'sonnet': 200000,
  'sonnet[1m]': 1000000,
  'opus': 200000,
  'opus[1m]': 1000000,
};

function getContextWindow(model?: string, customLimits?: Record<string, number>): number {
  if (model && customLimits?.[model]) return customLimits[model];
  if (model && MODEL_CONTEXT_WINDOWS[model]) return MODEL_CONTEXT_WINDOWS[model];
  return 200000;
}

export interface TransformRunnerOptions {
  intendedModel?: string;
  customContextLimits?: Record<string, number>;
}

export function* transformRunnerEvent(
  event: RunnerEvent,
  options?: TransformRunnerOptions,
): Generator<StreamEvent> {
  const parentToolUseId = event.parent_tool_use_id ?? null;

  switch (event.type) {
    case 'assistant': {
      const blocks = event.content || [];
      for (const block of blocks) {
        let agentEvent: StreamEvent | null = null;

        if (block.type === 'text' && block.text && block.text !== '(no content)') {
          agentEvent = { type: 'text', content: block.text };
        } else if (block.type === 'thinking' && block.thinking) {
          agentEvent = { type: 'thinking', content: block.thinking };
        } else if (block.type === 'tool_use') {
          agentEvent = { type: 'tool_use', id: block.id, name: block.name, input: block.input || {} };
        }

        if (agentEvent) {
          if (parentToolUseId) {
            yield { type: 'subagent_event', parentToolUseId, event: agentEvent as any };
          } else {
            yield agentEvent;
          }
        }
      }

      // Usage (main agent only, context = input + cache tokens)
      if (event.usage && !parentToolUseId) {
        const usage = event.usage;
        const model = options?.intendedModel;
        const contextWindow = getContextWindow(model, options?.customContextLimits);
        const inputTokens = usage.input_tokens || 0;
        const cacheCreationInputTokens = usage.cache_creation_input_tokens || 0;
        const cacheReadInputTokens = usage.cache_read_input_tokens || 0;
        const contextTokens = inputTokens + cacheCreationInputTokens + cacheReadInputTokens;
        const outputTokens = usage.output_tokens || 0;

        const usageInfo: UsageInfo = {
          model,
          inputTokens,
          outputTokens,
          cacheCreationInputTokens,
          cacheReadInputTokens,
          contextWindow,
          contextTokens,
          percentage: Math.min(100, Math.max(0, Math.round((contextTokens / contextWindow) * 100))),
        };
        yield { type: 'usage', usage: usageInfo };
      }

      if (event.uuid && !parentToolUseId) {
        yield { type: 'sdk_assistant_uuid', uuid: event.uuid };
      }
      break;
    }

    case 'user': {
      const content = event.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            const resultContent = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((c: any) => c.text || '').join('')
                : JSON.stringify(block.content);
            const toolResult: StreamEvent = {
              type: 'tool_result',
              id: block.tool_use_id,
              content: resultContent,
              isError: block.is_error || false,
            };
            if (parentToolUseId) {
              yield { type: 'subagent_event', parentToolUseId, event: toolResult as any };
            } else {
              yield toolResult;
            }
          }
        }
      }

      if (event._blocked && event._blockReason) {
        yield { type: 'blocked', content: event._blockReason };
      }
      break;
    }

    case 'result':
      break;

    case 'error':
      yield { type: 'error', content: event.error || 'Unknown error' };
      break;

    case 'system': {
      if (event.subtype === 'compact_boundary') yield { type: 'compact_boundary' };
      if (event.subtype === 'hook_started') {
        yield { type: 'hook_started', hookId: event.hook_id, hookName: event.hook_name, hookEvent: event.hook_event };
      }
      if (event.subtype === 'hook_progress') {
        yield { type: 'hook_progress', hookId: event.hook_id, hookName: event.hook_name, hookEvent: event.hook_event, output: event.content || '' };
      }
      if (event.subtype === 'hook_response') {
        yield { type: 'hook_response', hookId: event.hook_id, hookName: event.hook_name, hookEvent: event.hook_event, output: event.content || '', stdout: event.stdout, stderr: event.stderr, exitCode: event.exit_code, outcome: event.outcome || 'success' };
      }
      break;
    }

    case 'stream_event': {
      const inner = event.event;
      if (!inner) break;

      if (inner.type === 'content_block_start') {
        const cb = inner.content_block;
        if (cb?.type === 'tool_use') {
          const toolEvent: StreamEvent = { type: 'tool_use', id: cb.id, name: cb.name, input: cb.input || {} };
          if (parentToolUseId) {
            yield { type: 'subagent_event', parentToolUseId, event: toolEvent as any };
          } else {
            yield toolEvent;
          }
        } else if (cb?.type === 'thinking') {
          const thinkEvent: StreamEvent = { type: 'thinking', content: cb.thinking || '' };
          if (parentToolUseId) {
            yield { type: 'subagent_event', parentToolUseId, event: thinkEvent as any };
          } else {
            yield thinkEvent;
          }
        }
      } else if (inner.type === 'content_block_delta') {
        const delta = inner.delta;
        if (delta?.type === 'text_delta') {
          const textEvent: StreamEvent = { type: 'text', content: delta.text };
          if (parentToolUseId) {
            yield { type: 'subagent_event', parentToolUseId, event: textEvent as any };
          } else {
            yield textEvent;
          }
        } else if (delta?.type === 'thinking_delta') {
          const thinkEvent: StreamEvent = { type: 'thinking', content: delta.thinking };
          if (parentToolUseId) {
            yield { type: 'subagent_event', parentToolUseId, event: thinkEvent as any };
          } else {
            yield thinkEvent;
          }
        }
      }
      break;
    }
  }
}
