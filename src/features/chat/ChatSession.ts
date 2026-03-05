/**
 * ChatSession — owns one conversation's service, state, controllers, and renderers.
 *
 * Self-contained unit: when Phase 5 adds tabs, each tab gets its own ChatSession.
 * No Obsidian ItemView coupling — receives typed deps instead.
 */

import type { App, Component } from 'obsidian';
import { setIcon } from 'obsidian';

import type { AgentConfig, AgentService } from '../../core/agent';
import { createLogger } from '../../core/logging';
import { RunnerService } from '../../core/runner';
import type { CassandraSettings, PermissionMode, ThinkingBudget, UsageInfo } from '../../core/types';
import { InputController } from './controllers/InputController';
import { StreamController } from './controllers/StreamController';
import { MessageRenderer } from './rendering/MessageRenderer';
import { ChatState } from './state';
import { ComposerToolbar } from './ui';

const log = createLogger('ChatSession');

export interface ChatSessionDeps {
  config: AgentConfig;
  app: App;
  component: Component;
  containerEl: HTMLElement;
  saveSettings?: (settings: CassandraSettings) => Promise<void>;
}

export class ChatSession {
  private config: AgentConfig;
  private deps: ChatSessionDeps;
  private service: RunnerService | null = null;
  private state: ChatState;
  private renderer: MessageRenderer;
  private streamController: StreamController;
  private inputController: InputController;
  private toolbar: ComposerToolbar;

  // DOM refs
  private messagesEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;

  // Header elements
  private processingIndicatorEl: HTMLElement;
  private processingLabelEl: HTMLElement;
  private processingIconEl: HTMLElement;
  private statusEl: HTMLElement;
  private processingTimerInterval: ReturnType<typeof setInterval> | null = null;

  constructor(deps: ChatSessionDeps) {
    this.config = deps.config;
    this.deps = deps;

    // Build DOM
    const container = deps.containerEl;
    container.empty();
    container.addClass('cassandra-container');

    // ── Header ──
    const header = container.createEl('div', { cls: 'cassandra-header' });

    // Title slot (left)
    const titleSlot = header.createEl('div', { cls: 'cassandra-title-slot' });
    titleSlot.createEl('span', { cls: 'cassandra-logo', text: 'Cassandra' });

    // Processing indicator (center, hidden initially)
    this.processingIndicatorEl = header.createEl('div', { cls: 'cassandra-processing-indicator' });
    this.processingIndicatorEl.style.display = 'none';
    this.processingIconEl = this.processingIndicatorEl.createEl('span', { cls: 'cassandra-processing-indicator-icon' });
    setIcon(this.processingIconEl, 'loader');
    this.processingLabelEl = this.processingIndicatorEl.createEl('span', { cls: 'cassandra-processing-indicator-label' });

    // Header actions (right)
    const headerActions = header.createEl('div', { cls: 'cassandra-header-actions' });
    this.statusEl = headerActions.createEl('span', { cls: 'cassandra-status', text: 'Connecting...' });

    // New conversation button
    const newConvBtn = headerActions.createEl('div', { cls: 'cassandra-header-btn', attr: { 'aria-label': 'New conversation' } });
    setIcon(newConvBtn, 'square-pen');
    newConvBtn.addEventListener('click', () => this.handleNewConversation());

    // Messages area
    this.messagesEl = container.createEl('div', { cls: 'cassandra-messages' });

    // ── Composer ──
    const composer = container.createEl('div', { cls: 'cassandra-composer' });
    this.inputEl = composer.createEl('textarea', {
      cls: 'cassandra-input',
      attr: { placeholder: 'Message Cassandra...', rows: '3' },
    });

    // Toolbar
    const settings = this.config.settings;
    this.toolbar = new ComposerToolbar(composer, {
      onModelChange: (model) => this.handleModelChange(model),
      onThinkingChange: (budget) => this.handleThinkingChange(budget),
      onPermissionModeChange: (mode) => this.handlePermissionModeChange(mode),
      onVaultRestrictionChange: (enabled) => this.handleVaultRestrictionChange(enabled),
      onRefreshSession: () => this.handleRefreshSession(),
    }, {
      model: settings.model,
      thinkingBudget: settings.thinkingBudget,
      permissionMode: settings.permissionMode,
      vaultRestriction: settings.enableVaultRestriction,
      isStreaming: false,
      isReady: false,
      usage: null,
    });

    // State with callbacks
    this.state = new ChatState({
      onStreamingStateChanged: (isStreaming) => {
        this.updateProcessingIndicator(isStreaming);
        this.toolbar.update({ isStreaming });
      },
      onUsageChanged: (usage) => {
        if (!this.state.isStreaming) {
          this.statusEl.textContent = this.formatStatusText(usage);
        }
        this.toolbar.update({ usage });
      },
    });

    // Renderer
    this.renderer = new MessageRenderer(
      { app: deps.app, component: deps.component },
      this.messagesEl,
    );

    // StreamController
    this.streamController = new StreamController({
      state: this.state,
      renderer: this.renderer,
      getMessagesEl: () => this.messagesEl,
      getSettings: () => this.config.settings,
    });

    // InputController
    this.inputController = new InputController({
      state: this.state,
      getService: () => this.service as AgentService | null,
      streamController: this.streamController,
      renderer: this.renderer,
      getInputEl: () => this.inputEl,
      getSendBtn: () => null,
      getMessagesEl: () => this.messagesEl,
    });

    // Wire input events (Enter=send, Escape=cancel, Shift+Enter=newline)
    this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSendOrCancel();
      }
      if (e.key === 'Escape' && this.state.isStreaming) {
        e.preventDefault();
        this.inputController.cancelStreaming();
      }
    });

    // Auto-resize textarea
    this.inputEl.addEventListener('input', () => this.autoResize());

    // Init service
    this.initService();
  }

  private handleSendOrCancel(): void {
    if (this.state.isStreaming) {
      this.inputController.cancelStreaming();
    } else {
      this.inputController.handleSend();
    }
  }

  // ── Processing indicator ─────────────────────────────────────

  private updateProcessingIndicator(isStreaming: boolean): void {
    if (isStreaming) {
      this.processingIndicatorEl.style.display = '';
      this.processingIndicatorEl.classList.add('is-streaming');
      this.statusEl.style.display = 'none';
      this.updateProcessingLabel();
      // Start timer to update label every second
      this.clearProcessingTimer();
      this.processingTimerInterval = setInterval(() => this.updateProcessingLabel(), 1000);
    } else {
      this.clearProcessingTimer();
      this.processingIndicatorEl.style.display = 'none';
      this.processingIndicatorEl.classList.remove('is-streaming');
      this.statusEl.style.display = '';
      this.statusEl.textContent = this.formatStatusText();
    }
  }

  private updateProcessingLabel(): void {
    const parts: string[] = [];
    const toolCount = this.state.activeToolCallCount;

    if (toolCount > 0) {
      parts.push(`Processing ${toolCount === 1 ? '1 tool' : `${toolCount} tools`}`);
    } else {
      parts.push('Processing');
    }

    if (this.state.responseStartTime) {
      const elapsed = Math.max(0, Math.floor((performance.now() - this.state.responseStartTime) / 1000));
      const min = Math.floor(elapsed / 60);
      const sec = elapsed % 60;
      parts.push(`${min}:${String(sec).padStart(2, '0')}`);
    }

    this.processingLabelEl.textContent = parts.join(' - ');
  }

  private clearProcessingTimer(): void {
    if (this.processingTimerInterval) {
      clearInterval(this.processingTimerInterval);
      this.processingTimerInterval = null;
    }
  }

  // ── New conversation ─────────────────────────────────────────

  private async handleNewConversation(): Promise<void> {
    // Clean up current service
    this.service?.resetSession();
    this.state.resetStreamingState();
    this.state.clearMaps();

    // Clear messages
    this.messagesEl.empty();

    // Clear toolbar state
    this.toolbar.update({ isReady: false, usage: null, isStreaming: false });

    // Re-init
    this.statusEl.textContent = 'Connecting...';
    const ready = await this.service?.ensureReady();
    this.toolbar.update({ isReady: !!ready });
    this.statusEl.textContent = ready ? this.formatStatusText() : 'Disconnected';

    // Focus input
    this.inputEl.focus();
  }

  // ── Settings handlers ──────────────────────────────────────────

  private handleModelChange(model: string): void {
    this.config.settings.model = model;
    this.service?.updateConfig(this.config);
    this.persistSettings();
    this.toolbar.update({ model });
  }

  private handleThinkingChange(budget: ThinkingBudget): void {
    this.config.settings.thinkingBudget = budget;
    this.service?.updateConfig(this.config);
    this.persistSettings();
    this.toolbar.update({ thinkingBudget: budget });
  }

  private handlePermissionModeChange(mode: PermissionMode): void {
    this.config.settings.permissionMode = mode;
    this.service?.updateConfig(this.config);
    this.persistSettings();
    this.toolbar.update({ permissionMode: mode });
  }

  private handleVaultRestrictionChange(enabled: boolean): void {
    this.config.settings.enableVaultRestriction = enabled;
    this.service?.updateConfig(this.config);
    this.persistSettings();
    this.toolbar.update({ vaultRestriction: enabled });
  }

  private async handleRefreshSession(): Promise<void> {
    this.toolbar.update({ isReady: false });
    this.statusEl.textContent = 'Reconnecting...';
    this.service?.resetSession();
    const ready = await this.service?.ensureReady();
    this.toolbar.update({ isReady: !!ready });
    this.statusEl.textContent = ready ? this.formatStatusText() : 'Disconnected';
  }

  private persistSettings(): void {
    this.deps.saveSettings?.(this.config.settings);
  }

  // ── Service init ───────────────────────────────────────────────

  private async initService(): Promise<void> {
    try {
      this.service = new RunnerService(this.config);

      // Sync permission mode from runner (e.g. when EnterPlanMode fires)
      this.service.setPermissionModeSyncCallback((mode) => {
        this.toolbar.update({ permissionMode: mode as PermissionMode });
      });

      const ready = await this.service.ensureReady();
      this.statusEl.textContent = ready ? this.formatStatusText() : 'Disconnected';
      this.toolbar.update({ isReady: !!ready });
      if (!ready) {
        log.warn('service_not_ready');
      }
    } catch (err) {
      log.error('service_init_failed', { error: err instanceof Error ? err.message : String(err) });
      this.statusEl.textContent = 'Connection failed';
      this.toolbar.update({ isReady: false });
    }
  }

  // ── Helpers ────────────────────────────────────────────────────

  private autoResize(): void {
    const ta = this.inputEl;
    ta.style.height = 'auto';
    const containerH = ta.closest('.cassandra-container')?.clientHeight ?? 600;
    const maxH = Math.max(150, containerH * 0.55);
    ta.style.height = `${Math.min(ta.scrollHeight, maxH)}px`;
  }

  private formatStatusText(usage?: UsageInfo | null): string {
    const u = usage ?? this.state.usage;
    if (u) {
      return `Ready | ${this.formatTokens(u.contextTokens)} ctx (${u.percentage}%)`;
    }
    return 'Ready';
  }

  private formatTokens(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  updateConfig(config: AgentConfig): void {
    this.config = config;
    this.service?.updateConfig(config);
  }

  cleanup(): void {
    this.clearProcessingTimer();
    this.toolbar.destroy();
    this.service?.cleanup();
    this.service = null;
    this.state.resetStreamingState();
    this.state.clearMaps();
  }
}
