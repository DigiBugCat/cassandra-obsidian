import type { AgentService } from '@/core/agent';
import { InputController } from '@/features/chat/controllers/InputController';
import type { StreamController } from '@/features/chat/controllers/StreamController';
import type { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import { ChatState } from '@/features/chat/state/ChatState';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMessagesEl(): HTMLElement {
  return document.createElement('div');
}

function makeInputEl(value = ''): HTMLTextAreaElement {
  const el = document.createElement('textarea');
  el.value = value;
  return el;
}

function makeSendBtn(): HTMLElement {
  return document.createElement('button');
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

function makeStreamController(): jest.Mocked<StreamController> {
  return {
    handleStreamEvent: jest.fn().mockResolvedValue(undefined),
    showThinkingIndicator: jest.fn(),
    hideThinkingIndicator: jest.fn(),
    finalizeCurrentTextBlock: jest.fn(),
    finalizeCurrentThinkingBlock: jest.fn(),
    resetStreamingState: jest.fn(),
    appendText: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<StreamController>;
}

function makeService(events: Array<{ type: string; [k: string]: unknown }> = []): jest.Mocked<AgentService> {
  const defaultEvents = events.length > 0 ? events : [
    { type: 'text', content: 'hello' },
    { type: 'done' },
  ];

  return {
    query: jest.fn().mockImplementation(() =>
      (async function* () {
        for (const e of defaultEvents) {
          yield e;
        }
      })()
    ),
    cancel: jest.fn(),
    cleanup: jest.fn(),
    resetSession: jest.fn(),
    getBackend: jest.fn().mockReturnValue('runner'),
    getSessionId: jest.fn().mockReturnValue(null),
    setSessionId: jest.fn(),
    isReady: jest.fn().mockReturnValue(true),
    onReadyStateChange: jest.fn().mockReturnValue(() => {}),
    ensureReady: jest.fn().mockResolvedValue(true),
    setApprovalCallback: jest.fn(),
    setApprovalDismisser: jest.fn(),
    setAskUserQuestionCallback: jest.fn(),
  } as unknown as jest.Mocked<AgentService>;
}

interface ControllerFixture {
  controller: InputController;
  state: ChatState;
  service: jest.Mocked<AgentService>;
  streamController: jest.Mocked<StreamController>;
  renderer: jest.Mocked<MessageRenderer>;
  inputEl: HTMLTextAreaElement;
}

function makeController(options: {
  inputValue?: string;
  service?: jest.Mocked<AgentService> | null;
  streamEvents?: Array<{ type: string; [k: string]: unknown }>;
} = {}): ControllerFixture {
  const { inputValue = 'test message', service: svc, streamEvents } = options;

  const state = new ChatState();
  const renderer = makeRenderer();
  const streamController = makeStreamController();
  const inputEl = makeInputEl(inputValue);
  const messagesEl = makeMessagesEl();

  const service = svc !== undefined ? svc : makeService(streamEvents);

  const controller = new InputController({
    state,
    getService: () => service,
    streamController,
    renderer,
    getInputEl: () => inputEl,
    getSendBtn: () => makeSendBtn(),
    getMessagesEl: () => messagesEl,
  });

  return { controller, state, service: service as jest.Mocked<AgentService>, streamController, renderer, inputEl };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('InputController', () => {
  describe('handleSend() guards', () => {
    it('does not call service.query when already streaming', async () => {
      const { controller, state, service } = makeController();
      state.isStreaming = true;

      await controller.handleSend();

      expect(service.query).not.toHaveBeenCalled();
    });

    it('returns early when no agent service is available', async () => {
      const { controller, renderer } = makeController({ service: null });

      await controller.handleSend();

      expect(renderer.addMessage).not.toHaveBeenCalled();
    });

    it('returns early when input is empty (whitespace only)', async () => {
      const { controller, service } = makeController({ inputValue: '   ' });

      await controller.handleSend();

      expect(service.query).not.toHaveBeenCalled();
    });

    it('returns early when input is empty string', async () => {
      const { controller, service } = makeController({ inputValue: '' });

      await controller.handleSend();

      expect(service.query).not.toHaveBeenCalled();
    });
  });

  describe('handleSend() — successful flow', () => {
    it('creates a user message via renderer.addMessage', async () => {
      const { controller, renderer } = makeController({ inputValue: 'hello there' });

      await controller.handleSend();

      const userCallArgs = renderer.addMessage.mock.calls.find(
        ([msg]) => msg.role === 'user'
      );
      expect(userCallArgs).toBeDefined();
      expect(userCallArgs![0].content).toBe('hello there');
    });

    it('creates an assistant placeholder message via renderer.addMessage', async () => {
      const { controller, renderer } = makeController();

      await controller.handleSend();

      const assistantCallArgs = renderer.addMessage.mock.calls.find(
        ([msg]) => msg.role === 'assistant'
      );
      expect(assistantCallArgs).toBeDefined();
    });

    it('adds both messages to state.messages', async () => {
      const { controller, state } = makeController();

      await controller.handleSend();

      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].role).toBe('user');
      expect(state.messages[1].role).toBe('assistant');
    });

    it('clears the input element after send', async () => {
      const { controller, inputEl } = makeController({ inputValue: 'clear me' });

      await controller.handleSend();

      expect(inputEl.value).toBe('');
    });

    it('calls service.query with the prompt text', async () => {
      const { controller, service } = makeController({ inputValue: 'what is 2+2?' });

      await controller.handleSend();

      expect(service.query).toHaveBeenCalledWith('what is 2+2?', undefined, undefined, undefined);
    });

    it('bumps streamGeneration before starting the stream', async () => {
      const { controller, state } = makeController();
      const initialGen = state.streamGeneration;

      await controller.handleSend();

      expect(state.streamGeneration).toBeGreaterThan(initialGen);
    });

    it('sets isStreaming to true during the stream and false after', async () => {
      let wasStreamingDuringQuery = false;
      const { state } = makeController();

      // Observe state during query execution
      const service = makeService();
      service.query.mockImplementationOnce(() =>
        (async function* () {
          wasStreamingDuringQuery = state.isStreaming;
          yield { type: 'done' };
        })()
      );

      const ctrl = new InputController({
        state,
        getService: () => service,
        streamController: makeStreamController(),
        renderer: makeRenderer(),
        getInputEl: () => makeInputEl('test'),
        getSendBtn: () => document.createElement('button'),
        getMessagesEl: () => makeMessagesEl(),
      });

      await ctrl.handleSend();

      expect(wasStreamingDuringQuery).toBe(true);
      expect(state.isStreaming).toBe(false);
    });

    it('forwards stream events to streamController.handleStreamEvent', async () => {
      const { controller, streamController } = makeController({
        streamEvents: [
          { type: 'text', content: 'hello' },
          { type: 'done' },
        ],
      });

      await controller.handleSend();

      expect(streamController.handleStreamEvent).toHaveBeenCalledTimes(2);
    });

    it('calls streamController.showThinkingIndicator after state setup', async () => {
      const { controller, streamController } = makeController();

      await controller.handleSend();

      expect(streamController.showThinkingIndicator).toHaveBeenCalled();
    });

    it('calls streamController.hideThinkingIndicator in finally block', async () => {
      const { controller, streamController } = makeController();

      await controller.handleSend();

      expect(streamController.hideThinkingIndicator).toHaveBeenCalled();
    });

    it('calls streamController.finalizeCurrentTextBlock in finally block', async () => {
      const { controller, streamController } = makeController();

      await controller.handleSend();

      expect(streamController.finalizeCurrentTextBlock).toHaveBeenCalled();
    });

    it('calls streamController.resetStreamingState in finally block', async () => {
      const { controller, streamController } = makeController();

      await controller.handleSend();

      expect(streamController.resetStreamingState).toHaveBeenCalled();
    });

    it('resets cancelRequested to false after stream completes', async () => {
      const { controller, state } = makeController();

      await controller.handleSend();

      expect(state.cancelRequested).toBe(false);
    });

    it('resets activeToolCallCount to 0 after stream completes', async () => {
      const { controller, state } = makeController();
      state.activeToolCallCount = 5;

      await controller.handleSend();

      expect(state.activeToolCallCount).toBe(0);
    });
  });

  describe('handleSend() — bumpStreamGeneration', () => {
    it('bumps stream generation before iterating', async () => {
      const { controller, state } = makeController();
      const before = state.streamGeneration;

      await controller.handleSend();

      expect(state.streamGeneration).toBe(before + 1);
    });

    it('discards events from an old generation', async () => {
      // We simulate sending twice; on the second send the first generation's
      // events should be discarded because streamGeneration no longer matches.
      const state = new ChatState();
      const streamController = makeStreamController();
      const renderer = makeRenderer();

      let resolveFirst: () => void;
      const firstDone = new Promise<void>(r => (resolveFirst = r));

      // First query — yields a text event then waits
      const svc1 = {
        ...makeService(),
        query: jest.fn().mockImplementationOnce(() =>
          (async function* () {
            yield { type: 'text', content: 'gen1' };
            await firstDone;
          })()
        ),
      } as unknown as jest.Mocked<AgentService>;

      const ctrl = new InputController({
        state,
        getService: () => svc1,
        streamController,
        renderer,
        getInputEl: () => makeInputEl('msg'),
        getSendBtn: () => document.createElement('button'),
        getMessagesEl: () => makeMessagesEl(),
      });

      // Start first send (does not await yet)
      const send1 = ctrl.handleSend();

      // Manually bump generation to simulate a second send happening
      state.bumpStreamGeneration();

      // Now resolve the first generator
      resolveFirst!();
      await send1;

      // The loop should have completed without throwing
      expect(state.isStreaming).toBe(false);
    });
  });

  describe('cancelStreaming()', () => {
    it('sets cancelRequested to true', () => {
      const { controller, state } = makeController();
      state.isStreaming = true;

      controller.cancelStreaming();

      expect(state.cancelRequested).toBe(true);
    });

    it('calls service.cancel()', () => {
      const { controller, state, service } = makeController();
      state.isStreaming = true;

      controller.cancelStreaming();

      expect(service.cancel).toHaveBeenCalled();
    });

    it('calls streamController.hideThinkingIndicator', () => {
      const { controller, state, streamController } = makeController();
      state.isStreaming = true;

      controller.cancelStreaming();

      expect(streamController.hideThinkingIndicator).toHaveBeenCalled();
    });

    it('is a no-op when not streaming', () => {
      const { controller, state, service } = makeController();
      // isStreaming is false by default

      controller.cancelStreaming();

      expect(state.cancelRequested).toBe(false);
      expect(service.cancel).not.toHaveBeenCalled();
    });

    it('does not throw when service is null', () => {
      const state = new ChatState();
      const streamController = makeStreamController();

      const ctrl = new InputController({
        state,
        getService: () => null,
        streamController,
        renderer: makeRenderer(),
        getInputEl: () => makeInputEl(),
        getSendBtn: () => document.createElement('button'),
        getMessagesEl: () => makeMessagesEl(),
      });

      state.isStreaming = true;
      expect(() => ctrl.cancelStreaming()).not.toThrow();
    });
  });

  describe('handleSend() — error handling', () => {
    it('appends error content to assistantMsg when stream throws', async () => {
      const state = new ChatState();
      const renderer = makeRenderer();
      const streamController = makeStreamController();

      const errorService: jest.Mocked<AgentService> = {
        ...makeService(),
        query: jest.fn().mockImplementationOnce(() =>
          (async function* () {
            throw new Error('network failure');
            // eslint-disable-next-line no-unreachable
            yield { type: 'done' };
          })()
        ),
      } as unknown as jest.Mocked<AgentService>;

      const ctrl = new InputController({
        state,
        getService: () => errorService,
        streamController,
        renderer,
        getInputEl: () => makeInputEl('hello'),
        getSendBtn: () => document.createElement('button'),
        getMessagesEl: () => makeMessagesEl(),
      });

      await ctrl.handleSend();

      // After error, isStreaming should be false (finally block runs)
      expect(state.isStreaming).toBe(false);

      // The assistant message content should include the error
      const assistantMsg = state.messages.find(m => m.role === 'assistant');
      expect(assistantMsg?.content).toContain('network failure');
    });
  });
});
