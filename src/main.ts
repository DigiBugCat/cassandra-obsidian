import type { WorkspaceLeaf } from 'obsidian';
import { Plugin } from 'obsidian';

import type { AgentConfig } from './core/agent';
import { RunnerClient } from './core/runner';
import { SessionStorage, VaultFileAdapter } from './core/storage';
import type { CassandraSettings, ConversationMeta } from './core/types';
import { DEFAULT_SETTINGS } from './core/types';
import { CassandraView, VIEW_TYPE_CASSANDRA } from './features/chat/CassandraView';
import { ThreadOrganizerService } from './features/chat/services/ThreadOrganizerService';
import { ThreadSearchIndex } from './features/chat/services/ThreadSearchIndex';
import { ThreadSortService } from './features/chat/services/ThreadSortService';
import { ThreadsView, VIEW_TYPE_THREADS } from './features/chat/ThreadsView';
import { CassandraSettingsTab } from './features/settings/CassandraSettingsTab';

export default class CassandraPlugin extends Plugin {
  settings: CassandraSettings = { ...DEFAULT_SETTINGS };
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private adapter: VaultFileAdapter | null = null;
  private sessionStorage: SessionStorage | null = null;
  private organizer: ThreadOrganizerService | null = null;
  private searchIndex: ThreadSearchIndex | null = null;
  private sortService: ThreadSortService | null = null;
  private conversationCache: ConversationMeta[] = [];

  async onload() {
    await this.loadSettings();

    // Init storage
    this.adapter = new VaultFileAdapter(this.app);
    this.sessionStorage = new SessionStorage(this.adapter);
    this.organizer = new ThreadOrganizerService({
      adapter: this.adapter,
      storage: this.sessionStorage,
      getConversationList: () => this.sessionStorage!.list(),
      onCreateConversation: async (folderId) => {
        // Create a new tab in the main view, return the session metadata id
        await this.activateView();
        const view = this.getCassandraView();
        if (view) {
          const tabId = view.createNewTab();
          if (folderId && tabId) {
            await this.sessionStorage!.updateMeta(tabId, { threadFolderId: folderId });
          }
          return tabId || crypto.randomUUID();
        }
        return crypto.randomUUID();
      },
    });
    this.searchIndex = new ThreadSearchIndex(
      this.adapter,
      () => this.sessionStorage!.list(),
    );
    this.sortService = new ThreadSortService({
      getRunnerClient: () => new RunnerClient(this.settings.runnerUrl || 'https://claude-runner.cassandrasedge.com', this.settings.cfAccessClientId ? { clientId: this.settings.cfAccessClientId, clientSecret: this.settings.cfAccessClientSecret } : undefined),
      storage: this.sessionStorage,
      organizer: this.organizer,
      getConversationList: () => this.conversationCache,
    });

    // Load initial conversation cache
    this.refreshConversationCache();

    this.registerView(VIEW_TYPE_CASSANDRA, (leaf: WorkspaceLeaf) =>
      new CassandraView(
        leaf,
        this.getAgentConfig(),
        (s) => this.persistSettings(s),
        this.sessionStorage!,
        (conversationId) => this.deleteConversation(conversationId),
      ),
    );

    this.registerView(VIEW_TYPE_THREADS, (leaf: WorkspaceLeaf) =>
      new ThreadsView(leaf, {
        adapter: this.adapter!,
        storage: this.sessionStorage!,
        organizer: this.organizer!,
        searchIndex: this.searchIndex!,
        sortService: this.sortService!,
        getConversationList: () => this.conversationCache,
        updateConversation: async (id, partial) => {
          await this.sessionStorage!.updateMeta(id, partial);
          await this.refreshConversationCache();
        },
        activateMainView: () => this.activateView(),
        openConversation: async (conversationId) => {
          const view = this.getCassandraView();
          if (view) view.restoreSession(conversationId);
        },
        getActiveConversationId: () => {
          const view = this.getCassandraView();
          return view?.getActiveSessionId() ?? null;
        },
        forkConversation: async (id) => {
          await this.activateView();
          const view = this.getCassandraView();
          if (view) await view.forkConversation(id);
        },
        compactAndForkConversation: async (id) => {
          await this.activateView();
          const view = this.getCassandraView();
          if (view) await view.compactAndForkConversation(id);
        },
        deleteConversation: async (id) => {
          const view = this.getCassandraView();
          if (view) {
            await view.deleteConversation(id, true);
          } else {
            await this.deleteConversation(id);
          }
        },
        createConversationUnsorted: async () => {
          await this.activateView();
          const view = this.getCassandraView();
          view?.createNewTab();
        },
        createConversationInFolder: async (folderId) => {
          await this.activateView();
          const view = this.getCassandraView();
          const tabId = view?.createNewTab();
          if (folderId && tabId) {
            await this.sessionStorage!.updateMeta(tabId, { threadFolderId: folderId });
          }
        },
      }),
    );

    this.addRibbonIcon('bot', 'Open Cassandra', () => this.activateView());
    this.addRibbonIcon('list', 'Open Threads', () => this.activateThreadsView());

    this.addCommand({
      id: 'open-cassandra',
      name: 'Open chat',
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: 'open-threads',
      name: 'Open threads',
      callback: () => this.activateThreadsView(),
    });

    this.addSettingTab(new CassandraSettingsTab(this.app, this));

    // Periodically refresh conversation cache so threads view stays current
    this.refreshInterval = setInterval(() => this.refreshConversationCache(), 5000);
  }

  async onunload() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  getAgentConfig(): AgentConfig {
    const vaultPath = (this.app.vault.adapter as any).basePath || '';
    return {
      settings: this.settings,
      vaultPath,
      vaultName: this.app.vault.getName(),
    };
  }

  private getCassandraView(): CassandraView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CASSANDRA);
    return leaves.length > 0 ? (leaves[0].view as CassandraView) : null;
  }

  private async refreshConversationCache(): Promise<void> {
    try {
      this.conversationCache = await this.sessionStorage!.list();
    } catch { /* ignore */ }
    // Refresh threads view if open
    this.refreshThreadsView();
  }

  private async deleteConversation(conversationId: string): Promise<void> {
    const sessionMeta = await this.sessionStorage?.load(conversationId);
    if (sessionMeta?.runnerSessionId) {
      const client = new RunnerClient(this.settings.runnerUrl || 'https://claude-runner.cassandrasedge.com', this.settings.cfAccessClientId ? { clientId: this.settings.cfAccessClientId, clientSecret: this.settings.cfAccessClientSecret } : undefined);
      await client.deleteSession(sessionMeta.runnerSessionId);
    }

    await this.sessionStorage?.delete(conversationId);
    await this.refreshConversationCache();
  }

  private refreshThreadsView(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_THREADS);
    if (leaves.length > 0) {
      (leaves[0].view as ThreadsView).refresh().catch(() => {});
    }
  }

  private async loadSettings(): Promise<void> {
    const data = await this.loadData();
    if (data) {
      this.settings = { ...DEFAULT_SETTINGS, ...data };
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async persistSettings(updated: CassandraSettings): Promise<void> {
    this.settings = { ...updated };
    await this.saveData(this.settings);
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_CASSANDRA);

    if (leaves.length > 0) {
      workspace.revealLeaf(leaves[0]);
      return;
    }

    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_CASSANDRA, active: true });
      workspace.revealLeaf(leaf);
    }
  }

  private async activateThreadsView(): Promise<void> {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_THREADS);

    if (leaves.length > 0) {
      workspace.revealLeaf(leaves[0]);
      return;
    }

    const leaf = workspace.getLeftLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_THREADS, active: true });
      workspace.revealLeaf(leaf);
    }
  }
}
