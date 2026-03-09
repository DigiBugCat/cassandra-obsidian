const mockRunnerClients: Array<Record<string, jest.Mock>> = [];
const mockSessionStorageInstances: Array<Record<string, jest.Mock>> = [];
const mockSettingsTabs: unknown[] = [];

jest.mock('@/core/runner', () => {
  const actual = jest.requireActual('@/core/runner');

  return {
    ...actual,
    RunnerClient: jest.fn().mockImplementation(() => {
      const instance = {
        disconnect: jest.fn(),
        reconfigure: jest.fn(),
        deleteSession: jest.fn().mockResolvedValue(undefined),
      };
      mockRunnerClients.push(instance);
      return instance;
    }),
  };
});

jest.mock('@/core/storage', () => ({
  VaultFileAdapter: jest.fn().mockImplementation((app: unknown) => ({ app })),
  SessionStorage: jest.fn().mockImplementation(() => {
    const instance = {
      list: jest.fn().mockResolvedValue([]),
      load: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(undefined),
      updateMeta: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockSessionStorageInstances.push(instance);
    return instance;
  }),
}));

jest.mock('@/features/chat/services/ThreadOrganizerService', () => ({
  ThreadOrganizerService: jest.fn().mockImplementation((deps: unknown) => ({ deps })),
}));

jest.mock('@/features/chat/services/ThreadSearchIndex', () => ({
  ThreadSearchIndex: jest.fn().mockImplementation((...args: unknown[]) => ({ args })),
}));

jest.mock('@/features/chat/services/ThreadSortService', () => ({
  ThreadSortService: jest.fn().mockImplementation((...args: unknown[]) => ({ args })),
}));

jest.mock('@/features/chat/CassandraView', () => ({
  VIEW_TYPE_CASSANDRA: 'cassandra-view',
  CassandraView: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@/features/chat/ThreadsView', () => ({
  VIEW_TYPE_THREADS: 'cassandra-threads-view',
  ThreadsView: jest.fn().mockImplementation(() => ({
    refresh: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('@/features/settings/CassandraSettingsTab', () => ({
  CassandraSettingsTab: jest.fn().mockImplementation((...args: unknown[]) => {
    const instance = { args };
    mockSettingsTabs.push(instance);
    return instance;
  }),
}));

import { RunnerClient } from '@/core/runner';
import CassandraPlugin from '@/main';

function makeLeaf() {
  return {
    view: null,
    setViewState: jest.fn().mockResolvedValue(undefined),
  };
}

function makePlugin(loadDataResult: Record<string, unknown> = {}) {
  const rightLeaf = makeLeaf();
  const leftLeaf = makeLeaf();
  const leavesByType: Record<string, any[]> = {
    'cassandra-view': [],
    'cassandra-threads-view': [],
  };

  const workspace = {
    getLeavesOfType: jest.fn((type: string) => leavesByType[type] ?? []),
    getRightLeaf: jest.fn(() => rightLeaf),
    getLeftLeaf: jest.fn(() => leftLeaf),
    revealLeaf: jest.fn(),
    on: jest.fn(() => ({ id: 'workspace-event' })),
    off: jest.fn(),
  };

  const plugin = new (CassandraPlugin as any)();
  plugin.app = {
    vault: {
      adapter: { basePath: '/mock/vault' },
      getName: jest.fn(() => 'Mock Vault'),
    },
    workspace,
  };
  plugin.loadData = jest.fn().mockResolvedValue(loadDataResult);
  plugin.saveData = jest.fn().mockResolvedValue(undefined);
  plugin.addCommand = jest.fn();
  plugin.addRibbonIcon = jest.fn();
  plugin.addSettingTab = jest.fn();
  plugin.registerView = jest.fn();

  return {
    plugin,
    workspace,
    leavesByType,
    rightLeaf,
    leftLeaf,
  };
}

describe('CassandraPlugin lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockRunnerClients.length = 0;
    mockSessionStorageInstances.length = 0;
    mockSettingsTabs.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('loads settings, initializes dependencies, and registers plugin surfaces on load', async () => {
    const { plugin } = makePlugin({
      runnerUrl: 'http://runner.test',
      apiKey: 'secret-key',
      agentName: 'vault-agent',
    });

    await plugin.onload();

    expect(RunnerClient).toHaveBeenCalledWith('http://runner.test', 'secret-key');
    expect(plugin.registerView).toHaveBeenCalledTimes(2);
    expect(plugin.addRibbonIcon).toHaveBeenCalledWith('bot', 'Open Cassandra', expect.any(Function));
    expect(plugin.addRibbonIcon).toHaveBeenCalledWith('list', 'Open Threads', expect.any(Function));
    expect(plugin.addCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'open-cassandra', name: 'Open chat' }),
    );
    expect(plugin.addCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'open-threads', name: 'Open threads' }),
    );
    expect(plugin.addSettingTab).toHaveBeenCalledWith(mockSettingsTabs[0]);
    expect(mockSessionStorageInstances[0].list).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing Cassandra leaf instead of creating a new one', async () => {
    const { plugin, workspace, leavesByType } = makePlugin();
    const existingLeaf = makeLeaf();
    leavesByType['cassandra-view'] = [existingLeaf];

    await plugin.onload();

    const openChat = (plugin.addCommand as jest.Mock).mock.calls.find(
      ([command]) => command.id === 'open-cassandra',
    )?.[0].callback;

    await openChat();

    expect(workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
    expect(workspace.getRightLeaf).not.toHaveBeenCalled();
  });

  it('creates a right leaf when opening Cassandra without an existing view', async () => {
    const { plugin, workspace, rightLeaf } = makePlugin();

    await plugin.onload();

    const openChat = (plugin.addCommand as jest.Mock).mock.calls.find(
      ([command]) => command.id === 'open-cassandra',
    )?.[0].callback;

    await openChat();

    expect(workspace.getRightLeaf).toHaveBeenCalledWith(false);
    expect(rightLeaf.setViewState).toHaveBeenCalledWith({ type: 'cassandra-view', active: true });
    expect(workspace.revealLeaf).toHaveBeenCalledWith(rightLeaf);
  });

  it('reuses or creates the threads view on the left side', async () => {
    const { plugin, workspace, leftLeaf, leavesByType } = makePlugin();
    const existingLeaf = makeLeaf();

    await plugin.onload();

    const openThreads = (plugin.addCommand as jest.Mock).mock.calls.find(
      ([command]) => command.id === 'open-threads',
    )?.[0].callback;

    leavesByType['cassandra-threads-view'] = [existingLeaf];
    await openThreads();
    expect(workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);

    (workspace.revealLeaf as jest.Mock).mockClear();
    leavesByType['cassandra-threads-view'] = [];
    await openThreads();

    expect(workspace.getLeftLeaf).toHaveBeenCalledWith(false);
    expect(leftLeaf.setViewState).toHaveBeenCalledWith({ type: 'cassandra-threads-view', active: true });
    expect(workspace.revealLeaf).toHaveBeenCalledWith(leftLeaf);
  });

  it('reconfigures the runner client when settings are saved or persisted', async () => {
    const { plugin } = makePlugin({
      runnerUrl: 'http://runner.initial',
      apiKey: 'first-key',
    });

    await plugin.onload();

    plugin.settings.runnerUrl = 'http://runner.saved';
    plugin.settings.apiKey = 'saved-key';
    await plugin.saveSettings();

    expect(mockRunnerClients[0].reconfigure).toHaveBeenCalledWith('http://runner.saved', 'saved-key');

    mockRunnerClients[0].reconfigure.mockClear();

    await (plugin as any).persistSettings({
      runnerUrl: 'http://runner.persisted',
      apiKey: 'persisted-key',
    });

    expect(mockRunnerClients[0].reconfigure).toHaveBeenCalledWith(
      'http://runner.persisted',
      'persisted-key',
    );
    expect(plugin.saveData).toHaveBeenCalled();
  });

  it('clears the refresh interval and disconnects the client on unload', async () => {
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    const { plugin } = makePlugin();

    await plugin.onload();
    await plugin.onunload();

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(mockRunnerClients[0].disconnect).toHaveBeenCalledTimes(1);
  });
});
