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
import type { CassandraSettings, ChatMessage, ConversationMeta, ThinkingBudget, UsageInfo } from '../../core/types';
import { ApprovalModal } from '../../shared/ApprovalModal';
import { SlashCommandDropdown } from '../../shared/slash/SlashCommandDropdown';
import { InputController } from './controllers/InputController';
import { StreamController } from './controllers/StreamController';
import { MessageRenderer } from './rendering/MessageRenderer';
import { ChatState } from './state';
import { ComposerToolbar, FileContextManager, ImageContextManager } from './ui';

const log = createLogger('ChatSession');

export interface ChatSessionDeps {
  config: AgentConfig;
  app: App;
  component: Component;
  containerEl: HTMLElement;
  saveSettings?: (settings: CassandraSettings) => Promise<void>;
  sessionStorage?: SessionStorage;
  onTitleChanged?: (title: string) => void;
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
  private imageManager: ImageContextManager;
  private fileManager: FileContextManager;
  private slashDropdown: SlashCommandDropdown;

  // Current conversation metadata
  private conversationId: string;
  private conversationTitle = 'New conversation';
  private conversationCreatedAt: number;
  private messageCount = 0;
  private firstUserMessage = '';

  // DOM refs
  private messagesEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private documentClickHandler: () => void;

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

    // Context row (image previews, hidden by default)
    const contextRow = composer.createEl('div', { cls: 'cassandra-context-row' });

    this.inputEl = composer.createEl('textarea', {
      cls: 'cassandra-input',
      attr: { placeholder: 'Message Cassandra...', rows: '3' },
    });

    // File context manager (@-mentions + current note + drops)
    this.fileManager = new FileContextManager(deps.app, composer, contextRow, this.inputEl, {
      onFilesChanged: () => { /* chips update themselves */ },
    });

    // Image context manager (paste/drop, delegates non-image drops to file manager)
    this.imageManager = new ImageContextManager(composer, contextRow, this.inputEl, {
      onImagesChanged: () => { /* context row updates itself */ },
      onFileDropped: (fileName, file) => this.fileManager.addDroppedFile(fileName, file),
    });

    // Slash command dropdown (/ trigger)
    this.slashDropdown = new SlashCommandDropdown(this.inputEl, composer, {
      getCommands: async () => this.service?.getCommands() ?? [],
      onSelect: () => { /* command inserted into textarea */ },
    });

    // Toolbar
    const settings = this.config.settings;
    this.toolbar = new ComposerToolbar(composer, {
      onModelChange: (model) => this.handleModelChange(model),
      onThinkingChange: (budget) => this.handleThinkingChange(budget),
    }, {
      model: settings.model,
      thinkingBudget: settings.thinkingBudget,
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

    // Renderer — with rewind/fork callbacks
    this.renderer = new MessageRenderer(
      { app: deps.app, component: deps.component },
      this.messagesEl,
      {
        getMessages: () => this.state.getPersistedMessages(),
        onRewind: (messageId) => this.handleRewind(messageId),
        onFork: (messageId) => this.handleFork(messageId),
      },
    );

    // StreamController
    this.streamController = new StreamController({
      state: this.state,
      renderer: this.renderer,
      getMessagesEl: () => this.messagesEl,
      getSettings: () => this.config.settings,
      onSessionStale: (retryPrompt) => this.handleStaleSession(retryPrompt),
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
      getImages: () => this.imageManager.getImages(),
      clearImages: () => this.imageManager.clearImages(),
      getContextXml: () => this.fileManager.getContextXml(),
      getDocumentBlocks: () => this.fileManager.getDocumentContentBlocks(),
      clearFileContext: () => this.fileManager.clearAfterSend(),
      onSessionStale: () => this.handleStaleSession(),
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

    // Close history dropdown on outside click (stored for cleanup)
    this.documentClickHandler = () => this.closeHistoryDropdown();
    document.addEventListener('click', this.documentClickHandler);

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

  getConversationId(): string { return this.conversationId; }

  /** Attach to an existing runner session (e.g. from fork). Loads transcript after connecting. */
  async attachToRunnerSession(runnerSessionId: string): Promise<void> {
    this.service?.suppressTitleGeneration();
    this.toolbar.update({ isReady: false, usage: null, isStreaming: false });
    this.statusEl.textContent = 'Connecting to forked session...';

    this.service?.setSessionId(runnerSessionId);

    const cleanup = this.service?.onReadyStateChange(async (ready) => {
      if (ready) {
        cleanup?.();
        this.toolbar.update({ isReady: true });
        this.statusEl.textContent = this.formatStatusText();
        await this.loadTranscript();
        await this.saveSessionMetadata();
      }
    });
  }

  async restoreFromId(id: string): Promise<void> {
    const storage = this.deps.sessionStorage;
    if (!storage) return;
    const metas = await storage.list();
    const meta = metas.find(m => m.id === id);
    if (meta) await this.restoreSession(meta);
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
    this.service?.suppressTitleGeneration();

    // Re-attach to the runner session
    this.toolbar.update({ isReady: false, usage: null, isStreaming: false });
    this.statusEl.textContent = 'Reconnecting...';

    this.service?.setSessionId(sessionMeta.runnerSessionId);

    // Wait for ready, then load transcript
    const cleanup = this.service?.onReadyStateChange(async (ready) => {
      if (ready) {
        cleanup?.();
        this.toolbar.update({ isReady: true });
        this.statusEl.textContent = this.formatStatusText();
        await this.loadTranscript();
      }
    });

    this.inputEl.focus();
  }

  /** Fetch transcript from runner and render messages into the DOM. */
  private async loadTranscript(): Promise<void> {
    try {
      const events = await this.service?.getTranscript();
      if (!events || events.length === 0) return;

      const messages = this.parseTranscriptEvents(events);
      for (const msg of messages) {
        this.state.addMessage(msg);
        const msgEl = this.renderer.addMessage(msg);

        // Render assistant markdown content
        if (msg.role === 'assistant' && msg.content) {
          const contentEl = msgEl.querySelector('.cassandra-message-content') as HTMLElement;
          if (contentEl) {
            await this.renderer.renderContent(contentEl, msg.content);
            this.renderer.addTextCopyButton(contentEl, msg.content);
          }
        }
      }

      log.info('transcript_loaded', { messageCount: messages.length });
    } catch (err) {
      log.warn('transcript_load_failed', { error: String(err) });
    }
  }

  /** Parse JSONL transcript events into ChatMessage[]. */
  private parseTranscriptEvents(events: any[]): ChatMessage[] {
    const messages: ChatMessage[] = [];

    for (const event of events) {
      if (event.type === 'user') {
        const text = this.extractTextFromMessage(event.message);
        if (text) {
          messages.push({
            id: event.uuid || crypto.randomUUID(),
            role: 'user',
            content: text,
            timestamp: Date.now(),
            sdkUserUuid: event.uuid,
          });
        }
      } else if (event.type === 'assistant') {
        const text = this.extractTextFromMessage(event.message);
        if (text) {
          messages.push({
            id: event.uuid || crypto.randomUUID(),
            role: 'assistant',
            content: text,
            timestamp: Date.now(),
            sdkAssistantUuid: event.uuid,
          });
        }
      }
    }

    return messages;
  }

  /** Extract text content from a transcript message. */
  private extractTextFromMessage(message: any): string {
    if (!message) return '';

    // String content
    if (typeof message.content === 'string') return message.content;

    // Array of content blocks
    if (Array.isArray(message.content)) {
      const textParts: string[] = [];
      for (const block of message.content) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text);
        }
      }
      return textParts.join('\n\n');
    }

    // Role-level text
    if (typeof message === 'string') return message;

    return '';
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

    // Reset file context and slash command cache
    this.fileManager.reset();
    this.slashDropdown.invalidateCache();

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

  // ── Rewind / Fork ─────────────────────────────────────────────

  private async handleRewind(messageId: string): Promise<void> {
    if (this.state.isStreaming) return;

    const messages = this.state.getPersistedMessages();
    const msgIndex = messages.findIndex(m => m.id === messageId);
    if (msgIndex < 0) return;

    const msg = messages[msgIndex];
    if (!msg.sdkUserUuid) {
      log.warn('rewind_no_uuid', { messageId });
      return;
    }

    // Find the runner session
    const sessionId = this.service?.getSessionId();
    if (!sessionId) return;

    // Remove messages from this point onward in state
    const truncated = messages.slice(0, msgIndex);
    this.state.messages = truncated;

    // Remove message DOM elements after the rewind point
    const allMsgEls = this.messagesEl.querySelectorAll('.cassandra-message');
    for (let i = msgIndex; i < allMsgEls.length; i++) {
      allMsgEls[i].remove();
    }

    // Tell the runner to rewind
    // RunnerClient.rewind uses the user_message_uuid to rewind the SDK session
    (this.service as any)?.client?.rewind(sessionId, msg.sdkUserUuid);

    log.info('rewind', { messageId, sdkUserUuid: msg.sdkUserUuid, removedCount: messages.length - msgIndex });
    await this.saveSessionMetadata();
  }

  private async handleFork(messageId: string): Promise<void> {
    if (this.state.isStreaming) return;

    const messages = this.state.getPersistedMessages();
    const msg = messages.find(m => m.id === messageId);
    if (!msg?.sdkUserUuid) {
      log.warn('fork_no_uuid', { messageId });
      return;
    }

    // Set pendingResumeAt so the next query forks at this point
    this.service?.setPendingResumeAt(msg.sdkUserUuid);

    // Clear the current messages and DOM (the fork creates a new session)
    this.state.messages = [];
    this.messagesEl.empty();

    // Focus input — user types the new message which triggers the fork
    this.inputEl.focus();
    this.inputEl.placeholder = 'Type a message to fork from this point...';

    log.info('fork_pending', { messageId, sdkUserUuid: msg.sdkUserUuid });
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

  private async handleStaleSession(retryPrompt?: string): Promise<boolean> {
    log.info('stale_session_recovery', { hasRetryPrompt: !!retryPrompt });
    this.toolbar.update({ isReady: false });
    this.statusEl.textContent = 'Reconnecting...';

    // Try reconnecting (resumes stopped sessions via orchestrator)
    let ready = await this.service?.reconnect();

    // If reconnect/resume failed, fall back to a fresh session
    if (!ready) {
      log.info('stale_session_fallback_to_new');
      this.service?.resetSession();
      ready = await this.service?.ensureReady();
    }

    this.toolbar.update({ isReady: !!ready });
    this.statusEl.textContent = ready ? this.formatStatusText() : 'Disconnected';
    await this.saveSessionMetadata();

    // Auto-retry the message that failed
    if (ready && retryPrompt) {
      log.info('stale_session_retry', { prompt: retryPrompt.slice(0, 60) });
      this.inputEl.value = retryPrompt;
      setTimeout(() => this.handleSendOrCancel(), 200);
    }

    return !!ready;
  }

  private persistSettings(): void {
    this.deps.saveSettings?.(this.config.settings);
  }

  // ── Service init ───────────────────────────────────────────────

  private async initService(): Promise<void> {
    this.service = new RunnerService(this.config);

    // Wire approval callback
    this.service.setApprovalCallback(async (toolName, input, summary) => {
      const decision = await ApprovalModal.prompt(this.deps.app, toolName, input, summary);
      return decision === 'cancel' ? 'deny' : decision;
    });

    this.service.setOnSessionCreated((sessionId) => {
      log.info('session_created_callback', { sessionId });
      this.saveSessionMetadata();
    });

    this.service.setOnTitleGenerated((title) => {
      log.info('title_generated', { title });
      this.conversationTitle = title;
      this.deps.onTitleChanged?.(title);
      this.saveSessionMetadata();
    });

    await this.connectWithRetry();
  }

  private async connectWithRetry(maxRetries = 5): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.statusEl.textContent = attempt > 1 ? `Connecting (attempt ${attempt})...` : 'Connecting...';
        const ready = await this.service!.ensureReady();
        if (ready) {
          this.statusEl.textContent = this.formatStatusText();
          this.toolbar.update({ isReady: true });
          await this.saveSessionMetadata();
          return;
        }
      } catch (err) {
        log.warn('connect_attempt_failed', { attempt, error: err instanceof Error ? err.message : String(err) });
      }

      if (attempt < maxRetries) {
        const delay = Math.min(2000 * attempt, 10000);
        this.statusEl.textContent = `Retrying in ${Math.round(delay / 1000)}s...`;
        await new Promise(r => setTimeout(r, delay));
      }
    }

    log.error('connect_failed_all_retries', { maxRetries });
    this.statusEl.textContent = 'Disconnected';
    this.toolbar.update({ isReady: false });
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
    document.removeEventListener('click', this.documentClickHandler);
    this.toolbar.destroy();
    this.imageManager.destroy();
    this.fileManager.destroy();
    this.slashDropdown.destroy();
    this.service?.cleanup();
    this.service = null;
    this.state.resetStreamingState();
    this.state.clearMaps();
  }
}
