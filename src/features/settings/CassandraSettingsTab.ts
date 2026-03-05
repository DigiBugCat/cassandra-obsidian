/**
 * CassandraSettingsTab — Obsidian settings page for the Cassandra plugin.
 *
 * Groups: Runner, Model Defaults, Content, UI.
 */

import type { App } from 'obsidian';
import { PluginSettingTab, Setting } from 'obsidian';

import { DEFAULT_CLAUDE_MODELS } from '../../core/types';
import type CassandraPlugin from '../../main';

export class CassandraSettingsTab extends PluginSettingTab {
  plugin: CassandraPlugin;

  constructor(app: App, plugin: CassandraPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── Runner ──
    containerEl.createEl('h2', { text: 'Runner' });

    new Setting(containerEl)
      .setName('Runner URL')
      .setDesc('WebSocket/HTTP URL for the claude-agent-runner')
      .addText((text) =>
        text
          .setPlaceholder('http://localhost:9080')
          .setValue(this.plugin.settings.runnerUrl)
          .onChange(async (value) => {
            this.plugin.settings.runnerUrl = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Auto-start runner')
      .setDesc('Automatically start the runner Docker container on plugin load')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.runnerAutoStart)
          .onChange(async (value) => {
            this.plugin.settings.runnerAutoStart = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Project path')
      .setDesc('Working directory for the runner (defaults to vault path)')
      .addText((text) =>
        text
          .setPlaceholder('/path/to/project')
          .setValue(this.plugin.settings.runnerProjectPath)
          .onChange(async (value) => {
            this.plugin.settings.runnerProjectPath = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Obsidian Sync')
      .setDesc('Use Obsidian Sync to share the vault with the runner (requires auth token + E2EE password on the runner)')
      .addToggle((toggle) => {
        const vaultName = this.app.vault.getName();
        toggle
          .setValue(!!this.plugin.settings.runnerVaultName)
          .onChange(async (value) => {
            this.plugin.settings.runnerVaultName = value ? vaultName : '';
            await this.plugin.saveSettings();
          });
      });

    // ── Model Defaults ──
    containerEl.createEl('h2', { text: 'Model Defaults' });

    new Setting(containerEl)
      .setName('Model')
      .setDesc('Default Claude model')
      .addDropdown((dropdown) => {
        for (const m of DEFAULT_CLAUDE_MODELS) {
          dropdown.addOption(m.value, m.label);
        }
        dropdown
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Thinking')
      .setDesc('Enable extended thinking by default (medium budget, 8k tokens)')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.thinkingBudget !== 'off')
          .onChange(async (value) => {
            this.plugin.settings.thinkingBudget = value ? 'medium' : 'off';
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Permission mode')
      .setDesc('Default permission mode for tool execution')
      .addDropdown((dropdown) => {
        dropdown.addOption('default', 'Safe (ask before risky actions)');
        dropdown.addOption('acceptEdits', 'Accept Edits');
        dropdown.addOption('bypassPermissions', 'YOLO (skip all checks)');
        dropdown.addOption('plan', 'Plan only');
        dropdown.addOption('dontAsk', "Don't Ask");
        dropdown
          .setValue(this.plugin.settings.permissionMode)
          .onChange(async (value) => {
            this.plugin.settings.permissionMode = value as any;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Vault restriction')
      .setDesc('Restrict file access to the vault directory only')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableVaultRestriction)
          .onChange(async (value) => {
            this.plugin.settings.enableVaultRestriction = value;
            await this.plugin.saveSettings();
          }),
      );

    // ── Content ──
    containerEl.createEl('h2', { text: 'Content' });

    new Setting(containerEl)
      .setName('System prompt')
      .setDesc('Custom system prompt prepended to every conversation')
      .addTextArea((text) => {
        text
          .setPlaceholder('You are a helpful assistant...')
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.style.width = '100%';
      });

    new Setting(containerEl)
      .setName('Compact instructions')
      .setDesc('Instructions sent during conversation compaction')
      .addTextArea((text) => {
        text
          .setPlaceholder('Summarize the key context...')
          .setValue(this.plugin.settings.compactInstructions)
          .onChange(async (value) => {
            this.plugin.settings.compactInstructions = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 3;
        text.inputEl.style.width = '100%';
      });

    // ── UI ──
    containerEl.createEl('h2', { text: 'UI' });

    new Setting(containerEl)
      .setName('Auto-scroll')
      .setDesc('Automatically scroll to bottom when new content arrives')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoScroll)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoScroll = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Max tabs')
      .setDesc('Maximum number of simultaneous chat tabs')
      .addSlider((slider) =>
        slider
          .setLimits(1, 8, 1)
          .setValue(this.plugin.settings.maxTabs)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxTabs = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Auto-generate titles')
      .setDesc('Automatically generate conversation titles from the first message')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoTitleGeneration)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoTitleGeneration = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
