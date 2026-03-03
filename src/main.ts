import type { WorkspaceLeaf } from 'obsidian';
import { Plugin } from 'obsidian';

import { CassandraView, VIEW_TYPE_CASSANDRA } from './features/chat/CassandraView';

export default class CassandraPlugin extends Plugin {
  async onload() {
    this.registerView(VIEW_TYPE_CASSANDRA, (leaf: WorkspaceLeaf) => new CassandraView(leaf, this));

    this.addRibbonIcon('bot', 'Open Cassandra', () => this.activateView());

    this.addCommand({
      id: 'open-cassandra',
      name: 'Open chat',
      callback: () => this.activateView(),
    });
  }

  async onunload() {
    // Cleanup connections
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
}
