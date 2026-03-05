import type { WorkspaceLeaf } from 'obsidian';
import { ItemView } from 'obsidian';

import type { AgentConfig } from '../../core/agent';
import type { SessionStorage } from '../../core/storage';
import type { CassandraSettings } from '../../core/types';
import { ChatSession } from './ChatSession';

export const VIEW_TYPE_CASSANDRA = 'cassandra-view';

export class CassandraView extends ItemView {
  private config: AgentConfig;
  private session: ChatSession | null = null;
  private saveSettings?: (settings: CassandraSettings) => Promise<void>;
  private sessionStorage?: SessionStorage;

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
    this.session = new ChatSession({
      config: this.config,
      app: this.app,
      component: this,
      containerEl: container,
      saveSettings: this.saveSettings,
      sessionStorage: this.sessionStorage,
    });
  }

  async onClose(): Promise<void> {
    this.session?.cleanup();
    this.session = null;
  }
}
