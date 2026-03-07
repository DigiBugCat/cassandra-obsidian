import type { CassandraSettings,ChatMessage } from '@/core/types';
import { StreamController } from '@/features/chat/controllers/StreamController';
import type { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import { ChatState } from '@/features/chat/state/ChatState';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolCalls: [],
    contentBlocks: [],
    ...overrides,
  };
}

function makeSettings(overrides: Partial<CassandraSettings> = {}): CassandraSettings {
  return {
    runnerUrl: 'http://localhost:9080',
    runnerProjectPath: '',
    runnerVaultName: '',
    agentName: '',
    apiKey: '',
    model: 'sonnet',
    thinkingBudget: 'medium',
    permissionMode: 'default',
    enableVaultRestriction: false,
    mcpServersJson: '',
    systemPrompt: '',
    compactInstructions: '',
    persistentExternalContextPaths: [],
    customContextLimits: {},
    enableAutoTitleGeneration: false,
    enableAutoScroll: true,
    maxTabs: 3,
    ...overrides,
  };
}

function makeRenderer(): jest.Mocked<MessageRenderer> {
  return {
    addMessage: jest.fn().mockImplementation(() => {
      const el = document.createElement('div');
      el.innerHTML = '<div class="cassandra-message-content"></div>';
      return el;
    }),
    renderContent: jest.fn().mockResolvedValue(undefined),
    addTextCopyButton: jest.fn(),
    scrollToBottom: jest.fn(),
    scrollToBottomIfNeeded: jest.fn(),
  } as unknown as jest.Mocked<MessageRenderer>;
}

function makeMessagesEl(): HTMLElement {
  return document.createElement('div');
}

function makeController(
  _stateOverrides?: Partial<ChatState>,
  settingsOverrides?: Partial<CassandraSettings>
): { controller: StreamController; state: ChatState; renderer: jest.Mocked<MessageRenderer>; messagesEl: HTMLElement } {
  const state = new ChatState();
  const renderer = makeRenderer();
  const messagesEl = makeMessagesEl();

  // Set up a content element so rendering calls have somewhere to go
  const contentEl = document.createElement('div');
  contentEl.className = 'cassandra-message-content';
  messagesEl.appendChild(contentEl);
  state.currentContentEl = contentEl;

  const settings = makeSettings(settingsOverrides);

  const controller = new StreamController({
    state,
    renderer,
    getMessagesEl: () => messagesEl,
    getSettings: () => settings,
  });

  return { controller, state, renderer, messagesEl };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StreamController', () => {
  describe('handleStreamEvent — text event', () => {
    it('buffers text and renders via drip timer', async () => {
      jest.useFakeTimers();
      const { controller, state, renderer } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent({ type: 'text', content: 'hello' }, msg);

      // Text is in the drip buffer, not yet rendered
      expect(state.textDripBuffer).toBe('hello');
      expect(renderer.renderContent).not.toHaveBeenCalled();

      // Advance timer to trigger drip
      jest.advanceTimersByTime(35);
      expect(renderer.renderContent).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('accumulates content across multiple text events in drip buffer', async () => {
      jest.useFakeTimers();
      const { controller, state } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent({ type: 'text', content: 'foo' }, msg);
      await controller.handleStreamEvent({ type: 'text', content: ' bar' }, msg);

      expect(state.textDripBuffer).toBe('foo bar');

      // Flush via finalize
      controller.finalizeCurrentTextBlock(msg);
      expect(state.currentTextContent).toBe('');
      expect(msg.contentBlocks?.find(b => b.type === 'text')?.content).toBe('foo bar');

      jest.useRealTimers();
    });

    it('updates msg.content with the chunk content', async () => {
      const { controller } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent({ type: 'text', content: 'world' }, msg);

      expect(msg.content).toBe('world');
    });

    it('creates a text block element inside currentContentEl', async () => {
      const { controller, state } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent({ type: 'text', content: 'test' }, msg);

      expect(state.currentTextEl).not.toBeNull();
      expect(state.currentTextEl?.classList.contains('cassandra-text-block')).toBe(true);
    });
  });

  describe('handleStreamEvent — tool_use event', () => {
    it('buffers the tool in pendingTools map', async () => {
      const { controller, state } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent(
        { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
        msg
      );

      expect(state.pendingTools.has('tool-1')).toBe(true);
    });

    it('adds the tool call to msg.toolCalls', async () => {
      const { controller } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent(
        { type: 'tool_use', id: 'tool-2', name: 'Read', input: { file_path: '/tmp/test.ts' } },
        msg
      );

      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCalls![0].id).toBe('tool-2');
      expect(msg.toolCalls![0].name).toBe('Read');
    });

    it('increments activeToolCallCount', async () => {
      const { controller, state } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent(
        { type: 'tool_use', id: 'tool-3', name: 'Bash', input: {} },
        msg
      );

      expect(state.activeToolCallCount).toBe(1);
    });

    it('adds a tool_use content block to the message', async () => {
      const { controller } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent(
        { type: 'tool_use', id: 'tool-4', name: 'Bash', input: {} },
        msg
      );

      expect(msg.contentBlocks).toContainEqual({ type: 'tool_use', toolId: 'tool-4' });
    });
  });

  describe('handleStreamEvent — tool_result event', () => {
    it('updates the tool call status to completed on success', async () => {
      const { controller } = makeController();
      const msg = makeMessage();

      // First register the tool
      await controller.handleStreamEvent(
        { type: 'tool_use', id: 'tool-r1', name: 'Bash', input: {} },
        msg
      );

      // Then deliver the result
      await controller.handleStreamEvent(
        { type: 'tool_result', id: 'tool-r1', content: 'output text' },
        msg
      );

      expect(msg.toolCalls![0].status).toBe('completed');
    });

    it('updates the tool call status to error on failure', async () => {
      const { controller } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent(
        { type: 'tool_use', id: 'tool-r2', name: 'Bash', input: {} },
        msg
      );

      await controller.handleStreamEvent(
        { type: 'tool_result', id: 'tool-r2', content: 'error output', isError: true },
        msg
      );

      expect(msg.toolCalls![0].status).toBe('error');
    });

    it('stores the result content in toolCall.result', async () => {
      const { controller } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent(
        { type: 'tool_use', id: 'tool-r3', name: 'Bash', input: {} },
        msg
      );

      await controller.handleStreamEvent(
        { type: 'tool_result', id: 'tool-r3', content: 'result data' },
        msg
      );

      expect(msg.toolCalls![0].result).toBe('result data');
    });

    it('decrements activeToolCallCount', async () => {
      const { controller, state } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent(
        { type: 'tool_use', id: 'tool-r4', name: 'Bash', input: {} },
        msg
      );
      expect(state.activeToolCallCount).toBe(1);

      await controller.handleStreamEvent(
        { type: 'tool_result', id: 'tool-r4', content: 'done' },
        msg
      );

      expect(state.activeToolCallCount).toBe(0);
    });
  });

  describe('handleStreamEvent — usage event', () => {
    it('updates state.usage with the provided usage data', async () => {
      const { controller, state } = makeController();
      const msg = makeMessage();
      const usage = {
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        contextWindow: 200000,
        contextTokens: 150,
        percentage: 0.075,
      };

      await controller.handleStreamEvent({ type: 'usage', usage }, msg);

      expect(state.usage).toEqual(usage);
    });
  });

  describe('handleStreamEvent — done event', () => {
    it('flushes pending tools and finalizes text block', async () => {
      const { controller, state } = makeController();
      const msg = makeMessage();

      // Queue a tool
      await controller.handleStreamEvent(
        { type: 'tool_use', id: 'done-tool-1', name: 'Bash', input: {} },
        msg
      );
      expect(state.pendingTools.size).toBe(1);

      // Then accumulate some text
      await controller.handleStreamEvent({ type: 'text', content: 'result text' }, msg);

      // Done should flush and finalize
      await controller.handleStreamEvent({ type: 'done' }, msg);

      // pendingTools are flushed on text events (flushPendingTools called before appendText)
      // After done, text block should be finalized (currentTextEl cleared)
      expect(state.currentTextEl).toBeNull();
    });

    it('clears currentTextContent after done', async () => {
      const { controller, state } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent({ type: 'text', content: 'some text' }, msg);
      await controller.handleStreamEvent({ type: 'done' }, msg);

      expect(state.currentTextContent).toBe('');
    });

    it('pushes a text content block to msg.contentBlocks', async () => {
      const { controller } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent({ type: 'text', content: 'the answer' }, msg);
      await controller.handleStreamEvent({ type: 'done' }, msg);

      expect(msg.contentBlocks).toContainEqual({ type: 'text', content: 'the answer' });
    });
  });

  describe('flushPendingTools()', () => {
    it('renders buffered tools into the DOM', async () => {
      const { controller, state } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent(
        { type: 'tool_use', id: 'flush-tool-1', name: 'Bash', input: { command: 'echo hi' } },
        msg
      );
      expect(state.pendingTools.size).toBe(1);

      // Trigger flush by sending a text event (which calls flushPendingTools internally)
      await controller.handleStreamEvent({ type: 'text', content: 'hi' }, msg);

      // After flush, pending map should be empty
      expect(state.pendingTools.size).toBe(0);
    });

    it('adds the tool element to toolCallElements map after flush', async () => {
      const { controller, state } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent(
        { type: 'tool_use', id: 'flush-tool-2', name: 'Bash', input: {} },
        msg
      );

      // Flush via text event
      await controller.handleStreamEvent({ type: 'text', content: 'result' }, msg);

      expect(state.toolCallElements.has('flush-tool-2')).toBe(true);
    });

    it('clears pendingTools after flush', async () => {
      const { controller, state } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent(
        { type: 'tool_use', id: 'ft-1', name: 'Read', input: { file_path: '/tmp/x' } },
        msg
      );
      await controller.handleStreamEvent(
        { type: 'tool_use', id: 'ft-2', name: 'Read', input: { file_path: '/tmp/y' } },
        msg
      );

      await controller.handleStreamEvent({ type: 'done' }, msg);

      expect(state.pendingTools.size).toBe(0);
    });
  });

  describe('showThinkingIndicator()', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('schedules a timeout before showing the indicator', () => {
      const { controller, state } = makeController();

      controller.showThinkingIndicator();

      // Before the debounce delay, the element should not exist
      expect(state.thinkingEl).toBeNull();
      expect(state.thinkingIndicatorTimeout).not.toBeNull();
    });

    it('creates the thinking element after the debounce delay (400ms)', () => {
      const { controller, state } = makeController();
      state.responseStartTime = performance.now();

      controller.showThinkingIndicator();
      jest.advanceTimersByTime(400);

      expect(state.thinkingEl).not.toBeNull();
      expect(state.thinkingEl?.classList.contains('cassandra-thinking')).toBe(true);
    });

    it('does not create element before 400ms', () => {
      const { controller, state } = makeController();

      controller.showThinkingIndicator();
      jest.advanceTimersByTime(399);

      expect(state.thinkingEl).toBeNull();
    });

    it('does nothing when currentContentEl is null', () => {
      const { controller, state } = makeController();
      state.currentContentEl = null;

      controller.showThinkingIndicator();

      expect(state.thinkingIndicatorTimeout).toBeNull();
    });

    it('resets existing timeout when called again before delay', () => {
      const { controller, state } = makeController();

      controller.showThinkingIndicator();
      const firstTimeout = state.thinkingIndicatorTimeout;

      controller.showThinkingIndicator();
      const secondTimeout = state.thinkingIndicatorTimeout;

      // A new timeout was registered
      expect(secondTimeout).not.toBe(firstTimeout);
    });
  });

  describe('hideThinkingIndicator()', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('cancels a pending show timeout', () => {
      const { controller, state } = makeController();

      controller.showThinkingIndicator();
      expect(state.thinkingIndicatorTimeout).not.toBeNull();

      controller.hideThinkingIndicator();
      expect(state.thinkingIndicatorTimeout).toBeNull();

      // Advancing time should not create the element
      jest.advanceTimersByTime(400);
      expect(state.thinkingEl).toBeNull();
    });

    it('removes the thinking element from the DOM', () => {
      const { controller, state } = makeController();
      state.responseStartTime = performance.now();

      controller.showThinkingIndicator();
      jest.advanceTimersByTime(400);
      expect(state.thinkingEl).not.toBeNull();

      controller.hideThinkingIndicator();
      expect(state.thinkingEl).toBeNull();
    });

    it('clears flavorTimerInterval', () => {
      const { controller, state } = makeController();
      state.responseStartTime = performance.now();

      controller.showThinkingIndicator();
      jest.advanceTimersByTime(400);

      // The indicator creates an interval for the timer display
      // hideThinkingIndicator should clear it
      controller.hideThinkingIndicator();
      expect(state.flavorTimerInterval).toBeNull();
    });

    it('is safe to call when no indicator exists', () => {
      const { controller } = makeController();
      expect(() => controller.hideThinkingIndicator()).not.toThrow();
    });
  });

  describe('finalizeCurrentTextBlock()', () => {
    it('pushes a text content block when there is content', async () => {
      const { controller } = makeController();
      const msg = makeMessage();

      // Create a text block via appendText path
      await controller.handleStreamEvent({ type: 'text', content: 'hello world' }, msg);

      controller.finalizeCurrentTextBlock(msg);

      expect(msg.contentBlocks).toContainEqual({ type: 'text', content: 'hello world' });
    });

    it('resets currentTextEl to null', async () => {
      const { controller, state } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent({ type: 'text', content: 'abc' }, msg);
      expect(state.currentTextEl).not.toBeNull();

      controller.finalizeCurrentTextBlock(msg);
      expect(state.currentTextEl).toBeNull();
    });

    it('resets currentTextContent to empty string', async () => {
      const { controller, state } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent({ type: 'text', content: 'abc' }, msg);
      controller.finalizeCurrentTextBlock(msg);

      expect(state.currentTextContent).toBe('');
    });

    it('calls renderer.addTextCopyButton when finalizing non-empty block', async () => {
      const { controller, renderer } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent({ type: 'text', content: 'content here' }, msg);
      controller.finalizeCurrentTextBlock(msg);

      // addTextCopyButton is called asynchronously after renderContent resolves
      await Promise.resolve();
      expect(renderer.addTextCopyButton).toHaveBeenCalled();
    });

    it('does not push content block when text is empty', () => {
      const { controller } = makeController();
      const msg = makeMessage();

      // Do not produce any text events — currentTextContent stays ''
      controller.finalizeCurrentTextBlock(msg);

      const textBlocks = msg.contentBlocks?.filter(b => b.type === 'text') ?? [];
      expect(textBlocks).toHaveLength(0);
    });

    it('is safe to call with no msg argument', async () => {
      const { controller, state } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent({ type: 'text', content: 'data' }, msg);
      expect(() => controller.finalizeCurrentTextBlock()).not.toThrow();
      expect(state.currentTextEl).toBeNull();
    });
  });

  describe('resetStreamingState()', () => {
    it('clears currentContentEl', async () => {
      const { controller, state } = makeController();
      expect(state.currentContentEl).not.toBeNull();

      controller.resetStreamingState();
      expect(state.currentContentEl).toBeNull();
    });

    it('clears currentTextEl', async () => {
      const { controller, state } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent({ type: 'text', content: 'hi' }, msg);
      controller.resetStreamingState();

      expect(state.currentTextEl).toBeNull();
    });

    it('clears currentTextContent', async () => {
      const { controller, state } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent({ type: 'text', content: 'content' }, msg);
      controller.resetStreamingState();

      expect(state.currentTextContent).toBe('');
    });

    it('clears currentThinkingState', () => {
      const { controller, state } = makeController();
      state.currentThinkingState = {
        wrapperEl: document.createElement('div'),
        contentEl: document.createElement('div'),
        labelEl: document.createElement('span'),
        content: 'thinking',
        startTime: Date.now(),
        timerInterval: null,
        isExpanded: false,
      };

      controller.resetStreamingState();
      expect(state.currentThinkingState).toBeNull();
    });

    it('resets activeToolCallCount to 0', async () => {
      const { controller, state } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent(
        { type: 'tool_use', id: 'reset-tool', name: 'Bash', input: {} },
        msg
      );

      controller.resetStreamingState();
      expect(state.activeToolCallCount).toBe(0);
    });

    it('clears pendingTools map', async () => {
      const { controller, state } = makeController();
      const msg = makeMessage();

      await controller.handleStreamEvent(
        { type: 'tool_use', id: 'pending-tool', name: 'Bash', input: {} },
        msg
      );
      expect(state.pendingTools.size).toBe(1);

      controller.resetStreamingState();
      expect(state.pendingTools.size).toBe(0);
    });
  });
});
