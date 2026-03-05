/**
 * TabManager — manages multiple ChatSession tabs.
 *
 * Each tab has an id, a container element, and a ChatSession.
 * The active tab is visible; inactive tabs are display:none.
 */

import type { App, Component } from 'obsidian';

import type { AgentConfig } from '../../../core/agent';
import type { SessionStorage } from '../../../core/storage';
import type { CassandraSettings } from '../../../core/types';
import { ChatSession } from '../ChatSession';

export interface Tab {
  id: string;
  title: string;
  containerEl: HTMLElement;
  session: ChatSession;
}

export interface TabManagerDeps {
  config: AgentConfig;
  app: App;
  component: Component;
  contentEl: HTMLElement;
  saveSettings?: (settings: CassandraSettings) => Promise<void>;
  sessionStorage?: SessionStorage;
  onTabsChanged?: () => void;
  maxTabs: number;
}

export class TabManager {
  private tabs: Tab[] = [];
  private activeTabId: string | null = null;
  private deps: TabManagerDeps;

  constructor(deps: TabManagerDeps) {
    this.deps = deps;
  }

  getTabs(): Tab[] { return [...this.tabs]; }
  getActiveTabId(): string | null { return this.activeTabId; }
  getActiveTab(): Tab | undefined { return this.tabs.find(t => t.id === this.activeTabId); }
  getTabCount(): number { return this.tabs.length; }

  createTab(): Tab {
    // Enforce max tabs
    if (this.tabs.length >= this.deps.maxTabs) {
      // Close the oldest non-active tab
      const oldest = this.tabs.find(t => t.id !== this.activeTabId);
      if (oldest) this.closeTab(oldest.id);
    }

    const id = crypto.randomUUID();

    // Create container for this tab
    const containerEl = this.deps.contentEl.createEl('div', { cls: 'cassandra-tab-content' });
    containerEl.style.display = 'none';

    // Create ChatSession in this container
    const session = new ChatSession({
      config: this.deps.config,
      app: this.deps.app,
      component: this.deps.component,
      containerEl,
      saveSettings: this.deps.saveSettings,
      sessionStorage: this.deps.sessionStorage,
    });

    const tab: Tab = { id, title: 'New chat', containerEl, session };
    this.tabs.push(tab);

    // Activate it
    this.activateTab(id);
    this.deps.onTabsChanged?.();

    return tab;
  }

  activateTab(id: string): void {
    // Hide all tabs
    for (const tab of this.tabs) {
      tab.containerEl.style.display = tab.id === id ? '' : 'none';
    }
    this.activeTabId = id;
    this.deps.onTabsChanged?.();
  }

  closeTab(id: string): void {
    const idx = this.tabs.findIndex(t => t.id === id);
    if (idx === -1) return;

    const tab = this.tabs[idx];
    tab.session.cleanup();
    tab.containerEl.remove();
    this.tabs.splice(idx, 1);

    // If we closed the active tab, activate another
    if (this.activeTabId === id) {
      if (this.tabs.length > 0) {
        const newIdx = Math.min(idx, this.tabs.length - 1);
        this.activateTab(this.tabs[newIdx].id);
      } else {
        this.activeTabId = null;
      }
    }

    this.deps.onTabsChanged?.();
  }

  cleanup(): void {
    for (const tab of this.tabs) {
      tab.session.cleanup();
      tab.containerEl.remove();
    }
    this.tabs = [];
    this.activeTabId = null;
  }
}
