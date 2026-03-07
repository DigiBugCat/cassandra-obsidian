import { EventEmitter } from 'events';

import { RunnerService } from '../../../../src/core/runner';
import { type CassandraSettings,DEFAULT_SETTINGS } from '../../../../src/core/types';

function createConfig(settings?: Partial<CassandraSettings>) {
  return {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    vaultPath: '/mock/vault',
    vaultName: 'Mock Vault',
  };
}

class MockRunnerClient extends EventEmitter {
  connect = jest.fn(async () => {});
  isConnected = jest.fn(() => true);
  getSession = jest.fn();
  resumeSession = jest.fn();
  createSession = jest.fn();
  subscribe = jest.fn();
  unsubscribe = jest.fn();
  deleteSession = jest.fn(async () => {});
  stopSession = jest.fn(async () => {});
  getTranscript = jest.fn(async () => []);
  getCommands = jest.fn(async () => []);
  send = jest.fn();
  steer = jest.fn();
  respondToPermission = jest.fn();
  setOptions = jest.fn();
  generateTitle = jest.fn(async () => '');
  forkSession = jest.fn();
  rewind = jest.fn();
}

function createSessionDetail(status: string) {
  return {
    session_id: 'session-1',
    status,
    model: 'claude-sonnet-4-5',
    created_at: new Date().toISOString(),
    last_activity: new Date().toISOString(),
    message_count: 0,
    source: { type: 'workspace' as const, workspace: '/mock/vault' },
  };
}

describe('RunnerService', () => {
  let client: MockRunnerClient;

  beforeEach(() => {
    client = new MockRunnerClient();
  });

  it('attaches to an active session without resuming', async () => {
    client.getSession.mockResolvedValue(createSessionDetail('ready'));

    const service = new RunnerService(createConfig(), client as never);

    const attached = await service.attachToSession('session-1');

    expect(attached).toBe(true);
    expect(client.getSession).toHaveBeenCalledWith('session-1');
    expect(client.resumeSession).not.toHaveBeenCalled();
    expect(client.subscribe).toHaveBeenCalledWith('session-1');
    expect(service.getSessionId()).toBe('session-1');
    expect(service.isReady()).toBe(true);
  });

  it('resumes stopped sessions before attaching', async () => {
    client.getSession.mockResolvedValue(createSessionDetail('stopped'));
    client.resumeSession.mockResolvedValue({ session_id: 'session-1', resumed: true });

    const service = new RunnerService(createConfig(), client as never);

    const attached = await service.attachToSession('session-1');

    expect(attached).toBe(true);
    expect(client.resumeSession).toHaveBeenCalledWith('session-1');
    expect(client.subscribe).toHaveBeenCalledWith('session-1');
  });

  it('fails cleanly when attaching to a missing session', async () => {
    client.getSession.mockRejectedValue(new Error('missing'));

    const service = new RunnerService(createConfig(), client as never);

    const attached = await service.attachToSession('missing-session');

    expect(attached).toBe(false);
    expect(client.subscribe).not.toHaveBeenCalled();
    expect(service.getSessionId()).toBeNull();
  });

  it('cleanup detaches without deleting the remote session', async () => {
    client.getSession.mockResolvedValue(createSessionDetail('ready'));

    const service = new RunnerService(createConfig(), client as never);
    await service.attachToSession('session-1');

    service.cleanup();

    expect(client.unsubscribe).toHaveBeenCalledWith('session-1');
    expect(client.deleteSession).not.toHaveBeenCalled();
    expect(service.getSessionId()).toBeNull();
  });

  it('resetSession detaches without deleting the remote session', async () => {
    client.getSession.mockResolvedValue(createSessionDetail('ready'));

    const service = new RunnerService(createConfig(), client as never);
    await service.attachToSession('session-1');

    service.resetSession();

    expect(client.unsubscribe).toHaveBeenCalledWith('session-1');
    expect(client.deleteSession).not.toHaveBeenCalled();
    expect(service.getSessionId()).toBeNull();
  });

  it('deleteRemoteSession is explicitly destructive', async () => {
    client.getSession.mockResolvedValue(createSessionDetail('ready'));

    const service = new RunnerService(createConfig(), client as never);
    await service.attachToSession('session-1');

    await service.deleteRemoteSession();

    expect(client.deleteSession).toHaveBeenCalledWith('session-1');
    expect(service.getSessionId()).toBeNull();
  });
});
