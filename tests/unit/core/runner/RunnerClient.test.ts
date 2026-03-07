import { RunnerClient } from '../../../../src/core/runner';

class MockWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];

  constructor(url: string) {
    super();
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }
}

describe('RunnerClient', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockWebSocket.instances = [];
    global.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does not reconnect after an intentional disconnect', async () => {
    const client = new RunnerClient('http://localhost:9080');

    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();
    await connectPromise;

    client.disconnect();
    jest.advanceTimersByTime(3100);

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('reconnects and re-subscribes after an unexpected close', async () => {
    const client = new RunnerClient('http://localhost:9080');

    const connectPromise = client.connect();
    const firstSocket = MockWebSocket.instances[0];
    firstSocket.open();
    await connectPromise;

    client.subscribe('session-1');
    firstSocket.close();

    jest.advanceTimersByTime(3000);
    expect(MockWebSocket.instances).toHaveLength(2);

    const secondSocket = MockWebSocket.instances[1];
    secondSocket.open();
    await Promise.resolve();

    expect(secondSocket.sent.some(frame => frame.includes('"type":"subscribe"'))).toBe(true);
    expect(secondSocket.sent.some(frame => frame.includes('"session_id":"session-1"'))).toBe(true);
  });
});
