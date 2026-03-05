/**
 * ChatSession — owns one conversation's service, state, controllers, and renderers.
 *
 * Self-contained unit: when Phase 5 adds tabs, each tab gets its own ChatSession.
 * No Obsidian ItemView coupling — receives typed deps instead.
 */

import type { App, Component } from 'obsidian';

import type { AgentConfig, AgentService } from '../../core/agent';
import { createLogger } from '../../core/logging';
import { RunnerService } from '../../core/runner';
import type { UsageInfo } from '../../core/types';
import { InputController } from './controllers/InputController';
import { StreamController } from './controllers/StreamController';
import { MessageRenderer } from './rendering/MessageRenderer';
import { ChatState } from './state';

const log = createLogger('ChatSession');

export interface ChatSessionDeps {
  config: AgentConfig;
  app: App;
  component: Component;
  containerEl: HTMLElement;
}

export class ChatSession {
  private config: AgentConfig;
  private service: RunnerService | null = null;
  private state: ChatState;
  private renderer: MessageRenderer;
  private streamController: StreamController;
  private inputController: InputController;

  // DOM refs
  private messagesEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLElement;
  private statusEl: HTMLElement;

  constructor(deps: ChatSessionDeps) {
    this.config = deps.config;

    // Build DOM
    const container = deps.containerEl;
    container.empty();
    container.addClass('cassandra-container');

    // Header
    const header = container.createEl('div', { cls: 'cassandra-header' });
    header.createEl('span', { cls: 'cassandra-logo', text: 'Cassandra' });
    this.statusEl = header.createEl('span', { cls: 'cassandra-status', text: 'Connecting...' });

    // Messages area
    this.messagesEl = container.createEl('div', { cls: 'cassandra-messages' });

    // Input area
    const inputArea = container.createEl('div', { cls: 'cassandra-input-area' });
    this.inputEl = inputArea.createEl('textarea', {
      cls: 'cassandra-input',
      attr: { placeholder: 'Message Cassandra...', rows: '3' },
    });
    this.sendBtn = inputArea.createEl('button', { cls: 'cassandra-send-btn', text: 'Send' });

    // State with callbacks
    this.state = new ChatState({
      onStreamingStateChanged: (isStreaming) => {
        this.statusEl.textContent = isStreaming ? 'Streaming...' : this.formatStatusText();
        this.sendBtn.textContent = isStreaming ? 'Cancel' : 'Send';
      },
      onUsageChanged: (usage) => {
        if (!this.state.isStreaming) {
          this.statusEl.textContent = this.formatStatusText(usage);
        }
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
      getSendBtn: () => this.sendBtn,
      getMessagesEl: () => this.messagesEl,
    });

    // Wire input events
    this.sendBtn.addEventListener('click', () => this.handleSendOrCancel());
    this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.handleSendOrCancel();
      }
      if (e.key === 'Escape' && this.state.isStreaming) {
        e.preventDefault();
        this.inputController.cancelStreaming();
      }
    });

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

  private async initService(): Promise<void> {
    try {
      this.service = new RunnerService(this.config);
      const ready = await this.service.ensureReady();
      this.statusEl.textContent = ready ? this.formatStatusText() : 'Disconnected';
      if (!ready) {
        log.warn('service_not_ready');
      }
    } catch (err) {
      log.error('service_init_failed', { error: err instanceof Error ? err.message : String(err) });
      this.statusEl.textContent = 'Connection failed';
    }
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
    this.service?.cleanup();
    this.service = null;
    this.state.resetStreamingState();
    this.state.clearMaps();
  }
}
