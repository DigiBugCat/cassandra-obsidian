import type { WorkspaceLeaf } from 'obsidian';
import { ItemView } from 'obsidian';

import type CassandraPlugin from '../../main';

export const VIEW_TYPE_CASSANDRA = 'cassandra-view';

export class CassandraView extends ItemView {
  private plugin: CassandraPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: CassandraPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_CASSANDRA;
  }

  getDisplayText(): string {
    return 'Cassandra';
  }

  getIcon(): string {
    return 'bot';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.createEl('div', {
      cls: 'cassandra-container',
      text: 'Cassandra — ready.',
    });
  }

  async onClose(): Promise<void> {
    // Cleanup
  }
}
