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
import type { SessionMetadata, SessionStorage } from '../../core/storage';
import type { CassandraSettings, ConversationMeta, PermissionMode, ThinkingBudget, UsageInfo } from '../../core/types';
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
  sessionStorage?: SessionStorage;
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

  // Current conversation metadata
  private conversationId: string;
  private conversationTitle = 'New conversation';
  private conversationCreatedAt: number;
  private messageCount = 0;
  private firstUserMessage = '';

  // DOM refs
  private messagesEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;

  // Header elements
  private processingIndicatorEl: HTMLElement;
  private processingLabelEl: HTMLElement;
  private statusEl: HTMLElement;
  private historyDropdownEl: HTMLElement;
  private processingTimerInterval: ReturnType<typeof setInterval> | null = null;

  constructor(deps: ChatSessionDeps) {
    this.config = deps.config;
    this.deps = deps;
    this.conversationId = crypto.randomUUID();
    this.conversationCreatedAt = Date.now();

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
    const procIcon = this.processingIndicatorEl.createEl('span', { cls: 'cassandra-processing-indicator-icon' });
    setIcon(procIcon, 'loader');
    this.processingLabelEl = this.processingIndicatorEl.createEl('span', { cls: 'cassandra-processing-indicator-label' });

    // Header actions (right)
    const headerActions = header.createEl('div', { cls: 'cassandra-header-actions' });
    this.statusEl = headerActions.createEl('span', { cls: 'cassandra-status', text: 'Connecting...' });

    // History button + dropdown
    const historyContainer = headerActions.createEl('div', { cls: 'cassandra-history-container' });
    const historyBtn = historyContainer.createEl('div', { cls: 'cassandra-header-btn', attr: { 'aria-label': 'Chat history' } });
    setIcon(historyBtn, 'history');
    this.historyDropdownEl = historyContainer.createEl('div', { cls: 'cassandra-history-dropdown' });
    historyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleHistoryDropdown();
    });

    // New conversation button
    const newConvBtn = headerActions.createEl('div', { cls: 'cassandra-header-btn', attr: { 'aria-label': 'New conversation' } });
    setIcon(newConvBtn, 'square-pen');
    newConvBtn.addEventListener('click', () => this.handleNewConversation());

    // ── Messages area ──
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
        this.saveSessionMetadata();
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

    // InputController — wrap handleSend to track messages
    this.inputController = new InputController({
      state: this.state,
      getService: () => this.service as AgentService | null,
      streamController: this.streamController,
      renderer: this.renderer,
      getInputEl: () => this.inputEl,
      getSendBtn: () => null,
      getMessagesEl: () => this.messagesEl,
    });

    // Wire input events
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

    // Close history dropdown on outside click
    document.addEventListener('click', () => this.closeHistoryDropdown());

    // Init service
    this.initService();
  }

  private handleSendOrCancel(): void {
    if (this.state.isStreaming) {
      this.inputController.cancelStreaming();
    } else {
      // Track message count for metadata
      const prompt = this.inputEl.value.trim();
      if (prompt) {
        this.messageCount += 2; // user + assistant
        if (!this.firstUserMessage) {
          this.firstUserMessage = prompt.substring(0, 80);
          this.conversationTitle = prompt.substring(0, 50) || 'New conversation';
        }
      }
      this.inputController.handleSend();
      this.saveSessionMetadata();
    }
  }

  // ── Processing indicator ─────────────────────────────────────

  private updateProcessingIndicator(isStreaming: boolean): void {
    if (isStreaming) {
      this.processingIndicatorEl.style.display = '';
      this.processingIndicatorEl.classList.add('is-streaming');
      this.statusEl.style.display = 'none';
      this.updateProcessingLabel();
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

  // ── History dropdown ─────────────────────────────────────────

  private async toggleHistoryDropdown(): Promise<void> {
    if (this.historyDropdownEl.classList.contains('is-open')) {
      this.closeHistoryDropdown();
      return;
    }
    await this.renderHistoryDropdown();
    this.historyDropdownEl.classList.add('is-open');
  }

  private closeHistoryDropdown(): void {
    this.historyDropdownEl.classList.remove('is-open');
  }

  private async renderHistoryDropdown(): Promise<void> {
    this.historyDropdownEl.empty();
    const storage = this.deps.sessionStorage;
    if (!storage) {
      this.historyDropdownEl.createEl('div', { cls: 'cassandra-history-empty', text: 'No history available' });
      return;
    }

    const metas = await storage.list();
    if (metas.length === 0) {
      this.historyDropdownEl.createEl('div', { cls: 'cassandra-history-empty', text: 'No conversations yet' });
      return;
    }

    for (const meta of metas.slice(0, 20)) {
      const item = this.historyDropdownEl.createEl('div', {
        cls: `cassandra-history-item${meta.id === this.conversationId ? ' is-active' : ''}`,
      });
      const titleEl = item.createEl('div', { cls: 'cassandra-history-item-title', text: meta.title });
      titleEl.setAttribute('title', meta.title);
      const previewEl = item.createEl('div', { cls: 'cassandra-history-item-preview' });
      previewEl.textContent = meta.preview || 'Empty conversation';

      const deleteBtn = item.createEl('div', { cls: 'cassandra-history-item-delete' });
      setIcon(deleteBtn, 'x');
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await storage.delete(meta.id);
        await this.renderHistoryDropdown();
      });

      item.addEventListener('click', () => {
        this.closeHistoryDropdown();
        this.restoreSession(meta);
      });
    }
  }

  private async restoreSession(meta: ConversationMeta): Promise<void> {
    if (meta.id === this.conversationId) return;

    const storage = this.deps.sessionStorage;
    if (!storage) return;
    const sessionMeta = await storage.load(meta.id);
    if (!sessionMeta || !sessionMeta.runnerSessionId) {
      log.warn('restore_failed', { id: meta.id, reason: 'no runner session id' });
      return;
    }

    // Save current session before switching
    await this.saveSessionMetadata();

    // Reset state
    this.state.resetStreamingState();
    this.state.clearMaps();
    this.messagesEl.empty();

    // Adopt new conversation identity
    this.conversationId = meta.id;
    this.conversationTitle = meta.title;
    this.conversationCreatedAt = meta.createdAt;
    this.messageCount = meta.messageCount;
    this.firstUserMessage = meta.preview;

    // Re-attach to the runner session
    this.toolbar.update({ isReady: false, usage: null, isStreaming: false });
    this.statusEl.textContent = 'Reconnecting...';

    this.service?.setSessionId(sessionMeta.runnerSessionId);

    // Wait for ready
    this.service?.onReadyStateChange((ready) => {
      if (ready) {
        this.toolbar.update({ isReady: true });
        this.statusEl.textContent = this.formatStatusText();
      }
    });

    this.inputEl.focus();
  }

  // ── New conversation ─────────────────────────────────────────

  private async handleNewConversation(): Promise<void> {
    // Save current session
    await this.saveSessionMetadata();

    // Reset runner session
    this.service?.resetSession();
    this.state.resetStreamingState();
    this.state.clearMaps();
    this.messagesEl.empty();

    // New conversation identity
    this.conversationId = crypto.randomUUID();
    this.conversationTitle = 'New conversation';
    this.conversationCreatedAt = Date.now();
    this.messageCount = 0;
    this.firstUserMessage = '';

    // Re-init
    this.toolbar.update({ isReady: false, usage: null, isStreaming: false });
    this.statusEl.textContent = 'Connecting...';
    const ready = await this.service?.ensureReady();
    this.toolbar.update({ isReady: !!ready });
    this.statusEl.textContent = ready ? this.formatStatusText() : 'Disconnected';

    // Save the new session immediately
    await this.saveSessionMetadata();

    this.inputEl.focus();
  }

  // ── Session metadata persistence ─────────────────────────────

  private async saveSessionMetadata(): Promise<void> {
    const storage = this.deps.sessionStorage;
    if (!storage) return;

    const meta: SessionMetadata = {
      id: this.conversationId,
      title: this.conversationTitle,
      createdAt: this.conversationCreatedAt,
      updatedAt: Date.now(),
      lastResponseAt: this.state.usage ? Date.now() : undefined,
      runnerSessionId: this.service?.getSessionId() ?? null,
      usage: this.state.usage ?? undefined,
      messageCount: this.messageCount,
      preview: this.firstUserMessage || 'New conversation',
    };

    try {
      await storage.save(meta);
    } catch (err) {
      log.warn('save_metadata_failed', { error: String(err) });
    }
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
    await this.saveSessionMetadata();
  }

  private persistSettings(): void {
    this.deps.saveSettings?.(this.config.settings);
  }

  // ── Service init ───────────────────────────────────────────────

  private async initService(): Promise<void> {
    try {
      this.service = new RunnerService(this.config);

      this.service.setPermissionModeSyncCallback((mode) => {
        this.toolbar.update({ permissionMode: mode as PermissionMode });
      });

      this.service.setOnSessionCreated((sessionId) => {
        log.info('session_created_callback', { sessionId });
        this.saveSessionMetadata();
      });

      const ready = await this.service.ensureReady();
      this.statusEl.textContent = ready ? this.formatStatusText() : 'Disconnected';
      this.toolbar.update({ isReady: !!ready });
      if (!ready) {
        log.warn('service_not_ready');
      }

      // Save metadata now that we have a runner session id
      await this.saveSessionMetadata();
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
    this.saveSessionMetadata();
    this.clearProcessingTimer();
    this.toolbar.destroy();
    this.service?.cleanup();
    this.service = null;
    this.state.resetStreamingState();
    this.state.clearMaps();
  }
}
