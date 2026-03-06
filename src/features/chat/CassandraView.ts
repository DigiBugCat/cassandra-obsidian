import type { WorkspaceLeaf } from 'obsidian';
import { ItemView } from 'obsidian';

import type { AgentConfig } from '../../core/agent';
import type { SessionStorage } from '../../core/storage';
import type { CassandraSettings } from '../../core/types';
import { TabBar, TabManager } from './tabs';

export const VIEW_TYPE_CASSANDRA = 'cassandra-view';

export class CassandraView extends ItemView {
  private config: AgentConfig;
  private saveSettings?: (settings: CassandraSettings) => Promise<void>;
  private sessionStorage?: SessionStorage;

  private tabManager: TabManager | null = null;
  private tabBar: TabBar | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    config: AgentConfig,
    saveSettings?: (settings: CassandraSettings) => Promise<void>,
    sessionStorage?: SessionStorage,
  ) {
    super(leaf);
    this.config = config;
    this.saveSettings = saveSettings;
    this.sessionStorage = sessionStorage;
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

  /** Get the active tab's conversation/session id. */
  getActiveSessionId(): string | null {
    const tab = this.tabManager?.getActiveTab();
    return tab?.session.getConversationId() ?? null;
  }

  async onClose(): Promise<void> {
    this.tabManager?.cleanup();
    this.tabManager = null;
    this.tabBar?.destroy();
    this.tabBar = null;
  }
}
