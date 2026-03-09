import { EventEmitter } from 'events';
import { Component, MarkdownRenderer } from 'obsidian';

import type { AgentConfig } from '@/core/agent';
import { setLogSink } from '@/core/logging';
import { RunnerService } from '@/core/runner';
import { type CassandraSettings,DEFAULT_SETTINGS } from '@/core/types';
import { InputController } from '@/features/chat/controllers/InputController';
import { StreamController } from '@/features/chat/controllers/StreamController';
import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import { ChatState } from '@/features/chat/state/ChatState';

class MockRunnerClient extends EventEmitter {
  connected = false;
  sessionId = 'session-1';
  sendScenario: ((sessionId: string, message: string) => void) | null = null;

  connect = jest.fn(async () => {
    this.connected = true;
    this.emit('connected');
  });

  isConnected = jest.fn(() => this.connected);
  createSession = jest.fn(async () => ({ session_id: this.sessionId }));
  subscribe = jest.fn();
  unsubscribe = jest.fn();
  deleteSession = jest.fn(async () => {});
  stopSession = jest.fn(async () => {});
  getTranscript = jest.fn(async () => []);
  getCommands = jest.fn(async () => []);
  getSession = jest.fn(async () => ({
    session_id: this.sessionId,
    status: 'ready',
  }));
  resumeSession = jest.fn(async () => ({ session_id: this.sessionId, resumed: true }));
  generateTitle = jest.fn(async () => '');
  setOptions = jest.fn();
  forkSession = jest.fn();
  rewind = jest.fn();
  compactSession = jest.fn(async () => {});
  respondToPermission = jest.fn();
  reconfigure = jest.fn();
  disconnect = jest.fn(() => {
    this.connected = false;
  });
  send = jest.fn((sessionId: string, message: string) => {
    setTimeout(() => this.sendScenario?.(sessionId, message), 0);
    return 'request-1';
  });
  steer = jest.fn();

  emitSessionEvent(sessionId: string, event: Record<string, unknown>): void {
    this.emit(`event:${sessionId}`, event);
  }

  emitSessionError(sessionId: string, message: string): void {
    this.emit(`error:${sessionId}`, { message });
  }
}

function createConfig(settings?: Partial<CassandraSettings>): AgentConfig {
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      runnerUrl: 'http://runner.test',
      ...settings,
    },
    vaultPath: '/mock/vault',
    vaultName: 'Mock Vault',
  };
}

function createFixture(
  client: MockRunnerClient,
  onSessionStale?: (retryPrompt?: string) => Promise<boolean>,
) {
  const config = createConfig();
  const service = new RunnerService(config, client as never);
  const state = new ChatState();
  const messagesEl = document.createElement('div');
  const inputEl = document.createElement('textarea');
  inputEl.value = 'Hello runner';
  document.body.appendChild(messagesEl);

  const renderer = new MessageRenderer(
    { app: {} as any, component: new Component() },
    messagesEl,
    { getMessages: () => state.getPersistedMessages() },
  );

  const streamController = new StreamController({
    state,
    renderer,
    getMessagesEl: () => messagesEl,
    getSettings: () => config.settings,
    onSessionStale,
  });

  const inputController = new InputController({
    state,
    getService: () => service,
    streamController,
    renderer,
    getInputEl: () => inputEl,
    getSendBtn: () => null,
    getMessagesEl: () => messagesEl,
    onSessionStale,
  });

  return {
    service,
    state,
    messagesEl,
    inputEl,
    inputController,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('RunnerService websocket integration', () => {
  beforeAll(() => {
    jest.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, markdown, el) => {
      el.textContent = markdown;
    });
  });

  beforeEach(() => {
    setLogSink(() => {});
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('renders streamed websocket text into the visible assistant message', async () => {
    const client = new MockRunnerClient();
    client.sendScenario = (sessionId) => {
      client.emitSessionEvent(sessionId, {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello from the runner' },
        },
      });
      client.emitSessionEvent(sessionId, { type: 'result' });
    };

    const { inputController, messagesEl, state } = createFixture(client);

    await inputController.handleSend();
    await flushMicrotasks();

    const assistantText = messagesEl.querySelector('.cassandra-message-assistant .cassandra-text-block');

    expect(assistantText?.textContent).toBe('Hello from the runner');
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].content).toBe('Hello from the runner');
  });

  it('deduplicates assembled assistant text after stream deltas have already rendered', async () => {
    const client = new MockRunnerClient();
    client.sendScenario = (sessionId) => {
      client.emitSessionEvent(sessionId, {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'No duplicate output' },
        },
      });
      client.emitSessionEvent(sessionId, {
        type: 'assistant',
        content: [{ type: 'text', text: 'No duplicate output' }],
      });
      client.emitSessionEvent(sessionId, { type: 'result' });
    };

    const { inputController, messagesEl, state } = createFixture(client);

    await inputController.handleSend();
    await flushMicrotasks();

    const assistantText = messagesEl.querySelector('.cassandra-message-assistant .cassandra-text-block');

    expect(assistantText?.textContent).toBe('No duplicate output');
    expect(state.messages[1].content).toBe('No duplicate output');
  });

  it('propagates usage information from runner events into chat state', async () => {
    const client = new MockRunnerClient();
    client.sendScenario = (sessionId) => {
      client.emitSessionEvent(sessionId, {
        type: 'assistant',
        content: [{ type: 'text', text: 'Usage payload' }],
        usage: {
          input_tokens: 120,
          output_tokens: 30,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 20,
        },
      });
      client.emitSessionEvent(sessionId, { type: 'result' });
    };

    const { inputController, state } = createFixture(client);

    await inputController.handleSend();

    expect(state.usage).toEqual({
      model: 'sonnet',
      inputTokens: 120,
      outputTokens: 30,
      cacheCreationInputTokens: 10,
      cacheReadInputTokens: 20,
      contextWindow: 200000,
      contextTokens: 150,
      percentage: 0,
    });
  });

  it('routes stale-session websocket errors back through the recovery callback with the original prompt', async () => {
    const client = new MockRunnerClient();
    client.sendScenario = (sessionId) => {
      client.emitSessionError(sessionId, 'Session not found');
    };

    const onSessionStale = jest.fn(async () => true);
    const { inputController, inputEl } = createFixture(client, onSessionStale);
    inputEl.value = 'Recover this prompt';

    await inputController.handleSend();

    expect(onSessionStale).toHaveBeenCalledWith('Recover this prompt');
  });
});
