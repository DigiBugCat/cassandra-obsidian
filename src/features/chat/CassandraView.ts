import type { WorkspaceLeaf } from 'obsidian';
import { ItemView } from 'obsidian';
import { Notice } from 'obsidian';

import type { AgentConfig } from '../../core/agent';
import { createLogger } from '../../core/logging';
import { RunnerClient } from '../../core/runner';
import type { SessionStorage } from '../../core/storage';
import type { CassandraSettings } from '../../core/types';
import { TabBar, TabManager } from './tabs';

const log = createLogger('CassandraView');

export const VIEW_TYPE_CASSANDRA = 'cassandra-view';

export class CassandraView extends ItemView {
  private config: AgentConfig;
  private saveSettings?: (settings: CassandraSettings) => Promise<void>;
  private sessionStorage?: SessionStorage;
  private deleteConversationCallback?: (conversationId: string) => Promise<void>;

  private tabManager: TabManager | null = null;
  private tabBar: TabBar | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    config: AgentConfig,
    saveSettings?: (settings: CassandraSettings) => Promise<void>,
    sessionStorage?: SessionStorage,
    deleteConversation?: (conversationId: string) => Promise<void>,
  ) {
    super(leaf);
    this.config = config;
    this.saveSettings = saveSettings;
    this.sessionStorage = sessionStorage;
    this.deleteConversationCallback = deleteConversation;
  }

  getViewType(): string { return VIEW_TYPE_CASSANDRA; }
  getDisplayText(): string { return 'Cassandra'; }
  getIcon(): string { return 'bot'; }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('cassandra-view-root');

    // Tab bar (above content)
    this.tabBar = new TabBar(container, {
      onTabClick: (id) => {
        this.tabManager?.activateTab(id);
      },
      onTabClose: (id) => {
        this.tabManager?.closeTab(id);
        // Ensure at least one tab exists
        if (this.tabManager && this.tabManager.getTabCount() === 0) {
          this.tabManager.createTab();
        }
      },
      onNewTab: () => {
        this.tabManager?.createTab();
      },
    });

    // Content container (TabManager populates this)
    const contentEl = container.createEl('div', { cls: 'cassandra-tab-content-container' });

    // Tab manager
    this.tabManager = new TabManager({
      config: this.config,
      app: this.app,
      component: this,
      contentEl,
      saveSettings: this.saveSettings,
      sessionStorage: this.sessionStorage,
      deleteConversation: this.deleteConversationCallback,
      onTabsChanged: () => this.updateTabBar(),
      maxTabs: this.config.settings.maxTabs || 3,
    });

    // Create the initial tab
    this.tabManager.createTab();
  }

  private updateTabBar(): void {
    if (!this.tabManager || !this.tabBar) return;
    const tabs = this.tabManager.getTabs();
    const activeId = this.tabManager.getActiveTabId();
    this.tabBar.update(tabs.map(t => ({
      id: t.id,
      title: t.title,
      isActive: t.id === activeId,
    })));
  }

  /** Create a new tab and return the tab id. */
  createNewTab(): string | null {
    const tab = this.tabManager?.createTab();
    return tab?.id ?? null;
  }

  /** Restore a session by its metadata id — finds or creates a tab for it. */
  restoreSession(conversationId: string): void {
    // Check if any tab already has this conversation
    const existing = this.tabManager?.getTabs().find(t =>
      t.session.getConversationId() === conversationId,
    );
    if (existing) {
      this.tabManager?.activateTab(existing.id);
      return;
    }
    // Create a new tab and restore the session into it
    const tab = this.tabManager?.createTab();
    if (tab) {
      tab.session.restoreFromId(conversationId);
    }
  }

  /** Fork a conversation by its metadata id — creates a new tab with the forked runner session. */
  async forkConversation(conversationId: string): Promise<void> {
    if (!this.sessionStorage) return;

    // Load session metadata to get the runner session id
    const sessionMeta = await this.sessionStorage.load(conversationId);
    if (!sessionMeta?.runnerSessionId) {
      new Notice('Cannot fork: no runner session found');
      return;
    }

    try {
      // Fork the runner session via the orchestrator
      const client = new RunnerClient(this.config.settings.runnerUrl || 'https://claude-runner.cassandrasedge.com', this.config.settings.apiKey || undefined);
      const forkResult = await client.forkSession(sessionMeta.runnerSessionId, {});

      // Create a new tab
      const tab = this.tabManager?.createTab();
      if (!tab) return;

      // Attach the forked session to the new tab's ChatSession
      // The ChatSession's service will connect to this runner session
      tab.session.attachToRunnerSession(forkResult.session_id);
      tab.title = `Fork of ${sessionMeta.title}`;
      this.updateTabBar();

      log.info('fork_conversation', { source: conversationId, forked: forkResult.session_id });
    } catch (err) {
      log.warn('fork_failed', { conversationId, error: String(err) });
      new Notice(`Fork failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  /** Fork + compact a conversation — creates a forked session then schedules compaction. */
  async compactAndForkConversation(conversationId: string): Promise<void> {
    if (!this.sessionStorage) return;

    const sessionMeta = await this.sessionStorage.load(conversationId);
    if (!sessionMeta?.runnerSessionId) {
      new Notice('Cannot compact & fork: no runner session found');
      return;
    }

    try {
      const client = new RunnerClient(this.config.settings.runnerUrl || 'https://claude-runner.cassandrasedge.com', this.config.settings.apiKey || undefined);
      const forkResult = await client.forkSession(sessionMeta.runnerSessionId, {});

      // Schedule compaction on the forked session (runs on next query)
      await client.compactSession(
        forkResult.session_id,
        this.config.settings.compactInstructions || undefined,
      );

      // Create a new tab and attach
      const tab = this.tabManager?.createTab();
      if (!tab) return;

      tab.session.attachToRunnerSession(forkResult.session_id);
      tab.title = `Compact fork of ${sessionMeta.title}`;
      this.updateTabBar();

      log.info('compact_and_fork_conversation', { source: conversationId, forked: forkResult.session_id });
    } catch (err) {
      log.warn('compact_and_fork_failed', { conversationId, error: String(err) });
      new Notice(`Compact & fork failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  /** Get the active tab's conversation/session id. */
  getActiveSessionId(): string | null {
    const tab = this.tabManager?.getActiveTab();
    return tab?.session.getConversationId() ?? null;
  }

  async deleteConversation(conversationId: string, skipConfirm = false): Promise<void> {
    const existing = this.tabManager?.getTabs().find(t =>
      t.session.getConversationId() === conversationId,
    );
    if (existing) {
      await existing.session.deleteConversation(skipConfirm);
      this.updateTabBar();
      return;
    }

    await this.deleteConversationCallback?.(conversationId);
  }

  async onClose(): Promise<void> {
    this.tabManager?.cleanup();
    this.tabManager = null;
    this.tabBar?.destroy();
    this.tabBar = null;
  }
}
