import type { WorkspaceLeaf } from 'obsidian';
import { Plugin } from 'obsidian';

import type { AgentConfig } from './core/agent';
import type { CassandraSettings } from './core/types';
import { DEFAULT_SETTINGS } from './core/types';
import { CassandraView, VIEW_TYPE_CASSANDRA } from './features/chat/CassandraView';

export default class CassandraPlugin extends Plugin {
  settings: CassandraSettings = { ...DEFAULT_SETTINGS };

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_CASSANDRA, (leaf: WorkspaceLeaf) =>
      new CassandraView(leaf, this.getAgentConfig(), (s) => this.persistSettings(s)),
    );

    this.addRibbonIcon('bot', 'Open Cassandra', () => this.activateView());

    this.addCommand({
      id: 'open-cassandra',
      name: 'Open chat',
      callback: () => this.activateView(),
    });
  }

  async onunload() {
    // Views clean themselves up via onClose
  }

  getAgentConfig(): AgentConfig {
    const vaultPath = (this.app.vault.adapter as any).basePath || '';
    return {
      settings: this.settings,
      vaultPath,
    };
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
}
