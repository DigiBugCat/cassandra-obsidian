import type { WorkspaceLeaf } from 'obsidian';
import { ItemView } from 'obsidian';

import type { AgentConfig } from '../../core/agent';
import { ChatSession } from './ChatSession';

export const VIEW_TYPE_CASSANDRA = 'cassandra-view';

export class CassandraView extends ItemView {
  private config: AgentConfig;
  private session: ChatSession | null = null;

  constructor(leaf: WorkspaceLeaf, config: AgentConfig) {
    super(leaf);
    this.config = config;
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
    });
  }

  async onClose(): Promise<void> {
    this.session?.cleanup();
    this.session = null;
  }
}
