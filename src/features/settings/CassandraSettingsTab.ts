/**
 * CassandraSettingsTab — Obsidian settings page for the Cassandra plugin.
 *
 * Groups: Runner, Model Defaults, Content, UI.
 */

import type { App } from 'obsidian';
import { Modal, PluginSettingTab, Setting } from 'obsidian';

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

    new Setting(containerEl)
      .setName('Agent name')
      .setDesc('Persistent identity for this agent — isolates memory and transcripts per agent')
      .addText((text) =>
        text
          .setPlaceholder('e.g. cassandra')
          .setValue(this.plugin.settings.agentName)
          .onChange(async (value) => {
            this.plugin.settings.agentName = value.trim();
            await this.plugin.saveSettings();
          }),
      );

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

    // ── MCP Servers ──
    containerEl.createEl('h2', { text: 'MCP Servers' });

    const mcpListEl = containerEl.createEl('div', { cls: 'cassandra-mcp-list' });

    const renderMcpServers = () => {
      mcpListEl.empty();
      const servers = this.parseMcpServers();

      for (const [name, config] of Object.entries(servers)) {
        const serverEl = mcpListEl.createEl('div', { cls: 'cassandra-mcp-server-card' });

        new Setting(serverEl)
          .setName(name)
          .setDesc(`${config.command}${config.args?.length ? ' ' + config.args.join(' ') : ''}`)
          .addExtraButton((btn) =>
            btn.setIcon('pencil').setTooltip('Edit').onClick(() => {
              this.editMcpServer(name, config, renderMcpServers);
            }),
          )
          .addExtraButton((btn) =>
            btn.setIcon('trash').setTooltip('Remove').onClick(async () => {
              delete servers[name];
              this.plugin.settings.mcpServersJson = Object.keys(servers).length > 0
                ? JSON.stringify(servers, null, 2) : '';
              await this.plugin.saveSettings();
              renderMcpServers();
            }),
          );
      }

      new Setting(mcpListEl)
        .setName('Add MCP server')
        .setDesc('Configure a new MCP server for runner sessions')
        .addButton((btn) =>
          btn.setButtonText('Add').setCta().onClick(() => {
            this.editMcpServer(null, null, renderMcpServers);
          }),
        );
    };

    renderMcpServers();

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

  private parseMcpServers(): Record<string, { command: string; args?: string[]; env?: Record<string, string> }> {
    const json = this.plugin.settings.mcpServersJson;
    if (!json?.trim()) return {};
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
    } catch { /* invalid json */ }
    return {};
  }

  private editMcpServer(
    existingName: string | null,
    existingConfig: { command: string; args?: string[]; env?: Record<string, string> } | null,
    onSave: () => void,
  ): void {
    const modal = new McpServerModal(this.app, existingName, existingConfig, async (name, config) => {
      const servers = this.parseMcpServers();

      // If renaming, remove old entry
      if (existingName && existingName !== name) {
        delete servers[existingName];
      }

      servers[name] = config;
      this.plugin.settings.mcpServersJson = JSON.stringify(servers, null, 2);
      await this.plugin.saveSettings();
      onSave();
    });
    modal.open();
  }
}

class McpServerModal extends Modal {
  private name: string;
  private command: string;
  private args: string;
  private envVars: string;
  private onSubmit: (name: string, config: { command: string; args?: string[]; env?: Record<string, string> }) => void;

  constructor(
    app: App,
    name: string | null,
    config: { command: string; args?: string[]; env?: Record<string, string> } | null,
    onSubmit: (name: string, config: { command: string; args?: string[]; env?: Record<string, string> }) => void,
  ) {
    super(app);
    this.name = name ?? '';
    this.command = config?.command ?? '';
    this.args = config?.args?.join(' ') ?? '';
    this.envVars = config?.env ? Object.entries(config.env).map(([k, v]) => `${k}=${v}`).join('\n') : '';
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.name ? 'Edit MCP Server' : 'Add MCP Server' });

    new Setting(contentEl)
      .setName('Server name')
      .setDesc('Unique identifier (e.g. "my-mcp-server")')
      .addText((text) =>
        text
          .setPlaceholder('my-server')
          .setValue(this.name)
          .onChange((v) => { this.name = v; }),
      );

    new Setting(contentEl)
      .setName('Command')
      .setDesc('Executable to run (e.g. "npx", "node", "python")')
      .addText((text) =>
        text
          .setPlaceholder('npx')
          .setValue(this.command)
          .onChange((v) => { this.command = v; }),
      );

    new Setting(contentEl)
      .setName('Arguments')
      .setDesc('Space-separated arguments (e.g. "-y @modelcontextprotocol/server-filesystem")')
      .addText((text) =>
        text
          .setPlaceholder('-y @my/mcp-server')
          .setValue(this.args)
          .onChange((v) => { this.args = v; }),
      );

    new Setting(contentEl)
      .setName('Environment variables')
      .setDesc('One per line: KEY=value')
      .addTextArea((text) => {
        text
          .setPlaceholder('API_KEY=xxx\nDEBUG=true')
          .setValue(this.envVars)
          .onChange((v) => { this.envVars = v; });
        text.inputEl.rows = 3;
        text.inputEl.style.width = '100%';
        text.inputEl.style.fontFamily = 'var(--font-monospace)';
        text.inputEl.style.fontSize = '12px';
      });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText('Save').setCta().onClick(() => {
          if (!this.name.trim() || !this.command.trim()) return;

          const config: { command: string; args?: string[]; env?: Record<string, string> } = {
            command: this.command.trim(),
          };

          const args = this.args.trim();
          if (args) config.args = args.split(/\s+/);

          const envLines = this.envVars.trim();
          if (envLines) {
            config.env = {};
            for (const line of envLines.split('\n')) {
              const eq = line.indexOf('=');
              if (eq > 0) {
                config.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
              }
            }
          }

          this.onSubmit(this.name.trim(), config);
          this.close();
        }),
      )
      .addButton((btn) =>
        btn.setButtonText('Cancel').onClick(() => this.close()),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
