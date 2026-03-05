import { ChatState } from '@/features/chat/state/ChatState';
import type { ChatStateCallbacks } from '@/features/chat/state/ChatState';
import type { ChatMessage, UsageInfo } from '@/core/types';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'hello',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeUsage(overrides: Partial<UsageInfo> = {}): UsageInfo {
  return {
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    contextWindow: 200000,
    contextTokens: 150,
    percentage: 0.075,
    ...overrides,
  };
}

describe('ChatState', () => {
  describe('initial state', () => {
    it('starts with isStreaming=false', () => {
      const state = new ChatState();
      expect(state.isStreaming).toBe(false);
    });

    it('starts with empty messages array', () => {
      const state = new ChatState();
      expect(state.messages).toEqual([]);
    });

    it('starts with cancelRequested=false', () => {
      const state = new ChatState();
      expect(state.cancelRequested).toBe(false);
    });

    it('starts with activeToolCallCount=0', () => {
      const state = new ChatState();
      expect(state.activeToolCallCount).toBe(0);
    });

    it('starts with streamGeneration=0', () => {
      const state = new ChatState();
      expect(state.streamGeneration).toBe(0);
    });

    it('starts with usage=null', () => {
      const state = new ChatState();
      expect(state.usage).toBeNull();
    });

    it('starts with autoScrollEnabled=true', () => {
      const state = new ChatState();
      expect(state.autoScrollEnabled).toBe(true);
    });

    it('starts with responseStartTime=null', () => {
      const state = new ChatState();
      expect(state.responseStartTime).toBeNull();
    });

    it('starts with flavorTimerInterval=null', () => {
      const state = new ChatState();
      expect(state.flavorTimerInterval).toBeNull();
    });

    it('starts with empty tool tracking maps', () => {
      const state = new ChatState();
      expect(state.toolCallElements.size).toBe(0);
      expect(state.writeEditStates.size).toBe(0);
      expect(state.pendingTools.size).toBe(0);
      expect(state.hookElements.size).toBe(0);
    });
  });

  describe('addMessage()', () => {
    it('pushes the message to the messages array', () => {
      const state = new ChatState();
      const msg = makeMessage();
      state.addMessage(msg);
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]).toEqual(msg);
    });

    it('fires onMessagesChanged callback', () => {
      const onMessagesChanged = jest.fn();
      const state = new ChatState({ onMessagesChanged });
      state.addMessage(makeMessage());
      expect(onMessagesChanged).toHaveBeenCalledTimes(1);
    });

    it('accumulates multiple messages in order', () => {
      const state = new ChatState();
      const msg1 = makeMessage({ id: 'a', content: 'first' });
      const msg2 = makeMessage({ id: 'b', content: 'second' });
      state.addMessage(msg1);
      state.addMessage(msg2);
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].id).toBe('a');
      expect(state.messages[1].id).toBe('b');
    });

    it('fires callback for each message added', () => {
      const onMessagesChanged = jest.fn();
      const state = new ChatState({ onMessagesChanged });
      state.addMessage(makeMessage({ id: 'a' }));
      state.addMessage(makeMessage({ id: 'b' }));
      expect(onMessagesChanged).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearMessages()', () => {
    it('empties the messages array', () => {
      const state = new ChatState();
      state.addMessage(makeMessage());
      state.addMessage(makeMessage({ id: 'msg-2' }));
      state.clearMessages();
      expect(state.messages).toHaveLength(0);
    });

    it('fires onMessagesChanged callback', () => {
      const onMessagesChanged = jest.fn();
      const state = new ChatState({ onMessagesChanged });
      onMessagesChanged.mockClear();
      state.clearMessages();
      expect(onMessagesChanged).toHaveBeenCalledTimes(1);
    });

    it('works when messages are already empty', () => {
      const onMessagesChanged = jest.fn();
      const state = new ChatState({ onMessagesChanged });
      state.clearMessages();
      expect(state.messages).toHaveLength(0);
      expect(onMessagesChanged).toHaveBeenCalledTimes(1);
    });
  });

  describe('isStreaming setter', () => {
    it('fires onStreamingStateChanged with the new value', () => {
      const onStreamingStateChanged = jest.fn();
      const state = new ChatState({ onStreamingStateChanged });
      state.isStreaming = true;
      expect(onStreamingStateChanged).toHaveBeenCalledWith(true);
    });

    it('fires callback when set to false', () => {
      const onStreamingStateChanged = jest.fn();
      const state = new ChatState({ onStreamingStateChanged });
      state.isStreaming = true;
      onStreamingStateChanged.mockClear();
      state.isStreaming = false;
      expect(onStreamingStateChanged).toHaveBeenCalledWith(false);
    });

    it('updates the stored value', () => {
      const state = new ChatState();
      state.isStreaming = true;
      expect(state.isStreaming).toBe(true);
      state.isStreaming = false;
      expect(state.isStreaming).toBe(false);
    });
  });

  describe('bumpStreamGeneration()', () => {
    it('increments from 0 to 1', () => {
      const state = new ChatState();
      const result = state.bumpStreamGeneration();
      expect(result).toBe(1);
    });

    it('returns the new value each time', () => {
      const state = new ChatState();
      expect(state.bumpStreamGeneration()).toBe(1);
      expect(state.bumpStreamGeneration()).toBe(2);
      expect(state.bumpStreamGeneration()).toBe(3);
    });

    it('updates streamGeneration getter', () => {
      const state = new ChatState();
      state.bumpStreamGeneration();
      state.bumpStreamGeneration();
      expect(state.streamGeneration).toBe(2);
    });
  });

  describe('usage setter', () => {
    it('fires onUsageChanged with the new value', () => {
      const onUsageChanged = jest.fn();
      const state = new ChatState({ onUsageChanged });
      const usage = makeUsage();
      state.usage = usage;
      expect(onUsageChanged).toHaveBeenCalledWith(usage);
    });

    it('fires onUsageChanged with null when cleared', () => {
      const onUsageChanged = jest.fn();
      const state = new ChatState({ onUsageChanged });
      state.usage = makeUsage();
      onUsageChanged.mockClear();
      state.usage = null;
      expect(onUsageChanged).toHaveBeenCalledWith(null);
    });

    it('updates the stored value', () => {
      const state = new ChatState();
      const usage = makeUsage();
      state.usage = usage;
      expect(state.usage).toEqual(usage);
    });
  });

  describe('autoScrollEnabled setter', () => {
    it('fires onAutoScrollChanged when value changes from true to false', () => {
      const onAutoScrollChanged = jest.fn();
      const state = new ChatState({ onAutoScrollChanged });
      state.autoScrollEnabled = false;
      expect(onAutoScrollChanged).toHaveBeenCalledWith(false);
    });

    it('fires onAutoScrollChanged when value changes from false to true', () => {
      const onAutoScrollChanged = jest.fn();
      const state = new ChatState({ onAutoScrollChanged });
      state.autoScrollEnabled = false;
      onAutoScrollChanged.mockClear();
      state.autoScrollEnabled = true;
      expect(onAutoScrollChanged).toHaveBeenCalledWith(true);
    });

    it('does NOT fire callback when value does not change', () => {
      const onAutoScrollChanged = jest.fn();
      const state = new ChatState({ onAutoScrollChanged });
      // starts true, setting to true again
      state.autoScrollEnabled = true;
      expect(onAutoScrollChanged).not.toHaveBeenCalled();
    });

    it('updates the stored value', () => {
      const state = new ChatState();
      state.autoScrollEnabled = false;
      expect(state.autoScrollEnabled).toBe(false);
    });
  });

  describe('resetStreamingState()', () => {
    it('clears currentContentEl', () => {
      const state = new ChatState();
      state.currentContentEl = document.createElement('div');
      state.resetStreamingState();
      expect(state.currentContentEl).toBeNull();
    });

    it('clears currentTextEl', () => {
      const state = new ChatState();
      state.currentTextEl = document.createElement('div');
      state.resetStreamingState();
      expect(state.currentTextEl).toBeNull();
    });

    it('clears currentTextContent', () => {
      const state = new ChatState();
      state.currentTextContent = 'some accumulated text';
      state.resetStreamingState();
      expect(state.currentTextContent).toBe('');
    });

    it('clears currentThinkingState', () => {
      const state = new ChatState();
      state.currentThinkingState = {
        wrapperEl: document.createElement('div'),
        contentEl: document.createElement('div'),
        labelEl: document.createElement('span'),
        content: 'thinking...',
        startTime: Date.now(),
        timerInterval: null,
        isExpanded: false,
      };
      state.resetStreamingState();
      expect(state.currentThinkingState).toBeNull();
    });

    it('sets isStreaming to false (without firing callback)', () => {
      const state = new ChatState();
      // Use direct internal path (resetStreamingState bypasses the setter callback)
      state.isStreaming = true;
      state.resetStreamingState();
      expect(state.isStreaming).toBe(false);
    });

    it('sets cancelRequested to false', () => {
      const state = new ChatState();
      state.cancelRequested = true;
      state.resetStreamingState();
      expect(state.cancelRequested).toBe(false);
    });

    it('resets activeToolCallCount to 0', () => {
      const state = new ChatState();
      state.activeToolCallCount = 5;
      state.resetStreamingState();
      expect(state.activeToolCallCount).toBe(0);
    });

    it('clears thinkingIndicatorTimeout and sets it to null', () => {
      const state = new ChatState();
      const timeout = setTimeout(() => {}, 10000);
      state.thinkingIndicatorTimeout = timeout;
      state.resetStreamingState();
      expect(state.thinkingIndicatorTimeout).toBeNull();
    });

    it('clears flavorTimerInterval', () => {
      const state = new ChatState();
      const interval = setInterval(() => {}, 1000);
      state.flavorTimerInterval = interval;
      state.resetStreamingState();
      expect(state.flavorTimerInterval).toBeNull();
    });

    it('clears responseStartTime', () => {
      const state = new ChatState();
      state.responseStartTime = Date.now();
      state.resetStreamingState();
      expect(state.responseStartTime).toBeNull();
    });
  });

  describe('clearMaps()', () => {
    it('clears toolCallElements', () => {
      const state = new ChatState();
      state.toolCallElements.set('tool-1', document.createElement('div'));
      state.clearMaps();
      expect(state.toolCallElements.size).toBe(0);
    });

    it('clears writeEditStates', () => {
      const state = new ChatState();
      const el = document.createElement('div');
      state.writeEditStates.set('tool-2', {
        wrapperEl: el,
        contentEl: el,
        headerEl: el,
        nameEl: el,
        summaryEl: el,
        statsEl: el,
        statusEl: el,
        toolCall: { id: 'tool-2', name: 'Write', input: {}, status: 'running', isExpanded: false },
        isExpanded: false,
      });
      state.clearMaps();
      expect(state.writeEditStates.size).toBe(0);
    });

    it('clears pendingTools', () => {
      const state = new ChatState();
      state.pendingTools.set('tool-3', {
        toolCall: { id: 'tool-3', name: 'Bash', input: {}, status: 'running', isExpanded: false },
        parentEl: document.createElement('div'),
      });
      state.clearMaps();
      expect(state.pendingTools.size).toBe(0);
    });

    it('clears hookElements', () => {
      const state = new ChatState();
      state.hookElements.set('hook-1', document.createElement('div'));
      state.clearMaps();
      expect(state.hookElements.size).toBe(0);
    });

    it('clears all maps at once', () => {
      const state = new ChatState();
      const el = document.createElement('div');
      state.toolCallElements.set('a', el);
      state.hookElements.set('b', el);
      state.clearMaps();
      expect(state.toolCallElements.size).toBe(0);
      expect(state.hookElements.size).toBe(0);
    });
  });

  describe('resetForNewConversation()', () => {
    it('clears all messages', () => {
      const state = new ChatState();
      state.addMessage(makeMessage());
      state.resetForNewConversation();
      expect(state.messages).toHaveLength(0);
    });

    it('resets streaming state', () => {
      const state = new ChatState();
      state.currentContentEl = document.createElement('div');
      state.currentTextContent = 'leftover text';
      state.resetForNewConversation();
      expect(state.currentContentEl).toBeNull();
      expect(state.currentTextContent).toBe('');
    });

    it('clears all maps', () => {
      const state = new ChatState();
      state.toolCallElements.set('x', document.createElement('div'));
      state.pendingTools.set('y', { toolCall: { id: 'y', name: 'Bash', input: {}, status: 'running', isExpanded: false }, parentEl: null });
      state.resetForNewConversation();
      expect(state.toolCallElements.size).toBe(0);
      expect(state.pendingTools.size).toBe(0);
    });

    it('resets usage to null', () => {
      const state = new ChatState();
      state.usage = makeUsage();
      state.resetForNewConversation();
      expect(state.usage).toBeNull();
    });

    it('resets autoScrollEnabled to true', () => {
      const state = new ChatState();
      state.autoScrollEnabled = false;
      state.resetForNewConversation();
      expect(state.autoScrollEnabled).toBe(true);
    });

    it('fires onMessagesChanged callback', () => {
      const onMessagesChanged = jest.fn();
      const state = new ChatState({ onMessagesChanged });
      onMessagesChanged.mockClear();
      state.resetForNewConversation();
      expect(onMessagesChanged).toHaveBeenCalled();
    });
  });

  describe('clearFlavorTimerInterval()', () => {
    it('calls clearInterval and sets flavorTimerInterval to null', () => {
      const state = new ChatState();
      const interval = setInterval(() => {}, 10000);
      state.flavorTimerInterval = interval;
      state.clearFlavorTimerInterval();
      expect(state.flavorTimerInterval).toBeNull();
    });

    it('is a no-op when flavorTimerInterval is already null', () => {
      const state = new ChatState();
      expect(() => state.clearFlavorTimerInterval()).not.toThrow();
      expect(state.flavorTimerInterval).toBeNull();
    });

    it('actually prevents the interval callback from firing', () => {
      jest.useFakeTimers();
      const callback = jest.fn();
      const state = new ChatState();
      const interval = setInterval(callback, 100) as unknown as ReturnType<typeof setInterval>;
      state.flavorTimerInterval = interval;
      state.clearFlavorTimerInterval();
      jest.advanceTimersByTime(500);
      expect(callback).not.toHaveBeenCalled();
      jest.useRealTimers();
    });
  });

  describe('messages getter returns a copy', () => {
    it('returns a new array on each access', () => {
      const state = new ChatState();
      const a = state.messages;
      const b = state.messages;
      expect(a).not.toBe(b);
    });

    it('mutations to the returned array do not affect internal state', () => {
      const state = new ChatState();
      state.addMessage(makeMessage());
      const copy = state.messages;
      copy.push(makeMessage({ id: 'injected' }));
      expect(state.messages).toHaveLength(1);
    });
  });

  describe('callbacks can be replaced', () => {
    it('updates to the new callbacks object', () => {
      const first = jest.fn();
      const second = jest.fn();
      const state = new ChatState({ onMessagesChanged: first });
      state.callbacks = { onMessagesChanged: second };
      state.addMessage(makeMessage());
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });
  });
});
