import { transformRunnerEvent } from '@/core/runner/transformRunnerEvent';

describe('transformRunnerEvent', () => {
  it('transforms assistant text, thinking, and tool-use blocks', () => {
    const events = Array.from(transformRunnerEvent({
      type: 'assistant',
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'thinking', thinking: 'Reasoning...' },
        { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'pwd' } },
      ],
      uuid: 'assistant-1',
    } as any));

    expect(events).toEqual([
      { type: 'text', content: 'Hello' },
      { type: 'thinking', content: 'Reasoning...' },
      { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'pwd' } },
      { type: 'sdk_assistant_uuid', uuid: 'assistant-1' },
    ]);
  });

  it('transforms streamed text and thinking deltas', () => {
    const textEvents = Array.from(transformRunnerEvent({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'streamed text' },
      },
    } as any));

    const thinkingEvents = Array.from(transformRunnerEvent({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'streamed thinking' },
      },
    } as any));

    const toolEvents = Array.from(transformRunnerEvent({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          id: 'tool-2',
          name: 'Read',
          input: { file_path: '/tmp/test.md' },
        },
      },
    } as any));

    expect(textEvents).toEqual([{ type: 'text', content: 'streamed text' }]);
    expect(thinkingEvents).toEqual([{ type: 'thinking', content: 'streamed thinking' }]);
    expect(toolEvents).toEqual([
      {
        type: 'tool_use',
        id: 'tool-2',
        name: 'Read',
        input: { file_path: '/tmp/test.md' },
      },
    ]);
  });

  it('calculates usage from input and cache tokens with custom context limits', () => {
    const events = Array.from(transformRunnerEvent({
      type: 'assistant',
      content: [],
      usage: {
        input_tokens: 100,
        output_tokens: 25,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 50,
      },
    } as any, {
      intendedModel: 'custom-model',
      customContextLimits: { 'custom-model': 1000 },
    }));

    expect(events).toEqual([
      {
        type: 'usage',
        usage: {
          model: 'custom-model',
          inputTokens: 100,
          outputTokens: 25,
          cacheCreationInputTokens: 200,
          cacheReadInputTokens: 50,
          contextWindow: 1000,
          contextTokens: 350,
          percentage: 35,
        },
      },
    ]);
  });

  it('uses default context limits when no custom override is provided', () => {
    const events = Array.from(transformRunnerEvent({
      type: 'assistant',
      content: [],
      usage: {
        input_tokens: 500,
        output_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    } as any, {
      intendedModel: 'sonnet',
    }));

    expect(events).toEqual([
      {
        type: 'usage',
        usage: {
          model: 'sonnet',
          inputTokens: 500,
          outputTokens: 10,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          contextWindow: 200000,
          contextTokens: 500,
          percentage: 0,
        },
      },
    ]);
  });

  it('transforms user tool results and blocked states', () => {
    const events = Array.from(transformRunnerEvent({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-3',
            content: [{ text: 'part 1' }, { text: ' + part 2' }],
            is_error: true,
          },
        ],
      },
      _blocked: true,
      _blockReason: 'Permission denied',
    } as any));

    expect(events).toEqual([
      {
        type: 'tool_result',
        id: 'tool-3',
        content: 'part 1 + part 2',
        isError: true,
      },
      {
        type: 'blocked',
        content: 'Permission denied',
      },
    ]);
  });

  it('transforms error, compact-boundary, and hook events', () => {
    const errorEvents = Array.from(transformRunnerEvent({
      type: 'error',
      error: 'Boom',
    } as any));

    const compactEvents = Array.from(transformRunnerEvent({
      type: 'system',
      subtype: 'compact_boundary',
    } as any));

    const hookStarted = Array.from(transformRunnerEvent({
      type: 'system',
      subtype: 'hook_started',
      hook_id: 'hook-1',
      hook_name: 'Format',
      hook_event: 'pre-commit',
    } as any));

    const hookProgress = Array.from(transformRunnerEvent({
      type: 'system',
      subtype: 'hook_progress',
      hook_id: 'hook-1',
      hook_name: 'Format',
      hook_event: 'pre-commit',
      content: 'running',
    } as any));

    const hookResponse = Array.from(transformRunnerEvent({
      type: 'system',
      subtype: 'hook_response',
      hook_id: 'hook-1',
      hook_name: 'Format',
      hook_event: 'pre-commit',
      content: 'done',
      stdout: 'ok',
      stderr: '',
      exit_code: 0,
      outcome: 'success',
    } as any));

    expect(errorEvents).toEqual([{ type: 'error', content: 'Boom' }]);
    expect(compactEvents).toEqual([{ type: 'compact_boundary' }]);
    expect(hookStarted).toEqual([
      { type: 'hook_started', hookId: 'hook-1', hookName: 'Format', hookEvent: 'pre-commit' },
    ]);
    expect(hookProgress).toEqual([
      {
        type: 'hook_progress',
        hookId: 'hook-1',
        hookName: 'Format',
        hookEvent: 'pre-commit',
        output: 'running',
      },
    ]);
    expect(hookResponse).toEqual([
      {
        type: 'hook_response',
        hookId: 'hook-1',
        hookName: 'Format',
        hookEvent: 'pre-commit',
        output: 'done',
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
        outcome: 'success',
      },
    ]);
  });

  it('routes child events through subagent_event when parent_tool_use_id is present', () => {
    const events = Array.from(transformRunnerEvent({
      type: 'assistant',
      parent_tool_use_id: 'tool-parent',
      content: [
        { type: 'text', text: 'child output' },
        { type: 'thinking', thinking: 'child thinking' },
      ],
    } as any));

    expect(events).toEqual([
      {
        type: 'subagent_event',
        parentToolUseId: 'tool-parent',
        event: { type: 'text', content: 'child output' },
      },
      {
        type: 'subagent_event',
        parentToolUseId: 'tool-parent',
        event: { type: 'thinking', content: 'child thinking' },
      },
    ]);
  });
});
