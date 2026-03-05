import type { WorkspaceLeaf } from 'obsidian';
import { ItemView, MarkdownRenderer } from 'obsidian';

import type { AgentConfig } from '../../core/agent';
import { RunnerService } from '../../core/runner';
import type { ChatMessage, StreamEvent } from '../../core/types';

export const VIEW_TYPE_CASSANDRA = 'cassandra-view';

export class CassandraView extends ItemView {
  private config: AgentConfig;
  private service: RunnerService | null = null;
  private messages: ChatMessage[] = [];
  private streaming = false;

  // DOM
  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private statusEl: HTMLElement | null = null;
  private sendBtn: HTMLElement | null = null;


  constructor(leaf: WorkspaceLeaf, config: AgentConfig) {
    super(leaf);
    this.config = config;
  }

  getViewType(): string { return VIEW_TYPE_CASSANDRA; }
  getDisplayText(): string { return 'Cassandra'; }
  getIcon(): string { return 'bot'; }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
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

    // Events
    this.sendBtn.addEventListener('click', () => this.handleSend());
    this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.handleSend();
      }
    });

    // Init runner
    this.service = new RunnerService(this.config);
    const ready = await this.service.ensureReady();
    this.updateStatus(ready ? 'Ready' : 'Disconnected');
  }

  async onClose(): Promise<void> {
    this.service?.cleanup();
    this.service = null;
  }

  private async handleSend(): Promise<void> {
    if (!this.inputEl || !this.service || this.streaming) return;

    const prompt = this.inputEl.value.trim();
    if (!prompt) return;

    this.inputEl.value = '';
    this.streaming = true;
    this.updateStatus('Streaming...');
    if (this.sendBtn) this.sendBtn.textContent = '...';

    // Add user message
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };
    this.messages.push(userMsg);
    this.renderMessage(userMsg);

    // Create assistant message placeholder
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
    };
    this.messages.push(assistantMsg);
    const assistantEl = this.renderMessage(assistantMsg);

    // Stream response
    try {
      const stream = this.service.query(prompt);
      for await (const event of stream) {
        this.handleStreamEvent(event, assistantMsg, assistantEl);
      }
    } catch (err) {
      assistantMsg.content += `\n\nError: ${err instanceof Error ? err.message : String(err)}`;
    }

    this.updateAssistantEl(assistantMsg, assistantEl);
    this.streaming = false;
    this.updateStatus('Ready');
    if (this.sendBtn) this.sendBtn.textContent = 'Send';
    this.scrollToBottom();
  }

  private handleStreamEvent(event: StreamEvent, msg: ChatMessage, el: HTMLElement): void {
    switch (event.type) {
      case 'text':
        msg.content += event.content;
        this.updateAssistantEl(msg, el);
        this.scrollToBottom();
        break;

      case 'thinking':
        // Show thinking indicator
        break;

      case 'tool_use': {
        const toolCall = { id: event.id, name: event.name, input: event.input, status: 'running' as const };
        if (!msg.toolCalls) msg.toolCalls = [];
        msg.toolCalls.push(toolCall);
        this.updateAssistantEl(msg, el);
        break;
      }

      case 'tool_result': {
        const tc = msg.toolCalls?.find(t => t.id === event.id);
        if (tc) {
          tc.status = event.isError ? 'error' : 'completed';
          tc.result = event.content;
          this.updateAssistantEl(msg, el);
        }
        break;
      }

      case 'usage':
        this.updateStatus(`Ready | ${this.formatTokens(event.usage.contextTokens)} ctx (${event.usage.percentage}%)`);
        break;

      case 'error':
        msg.content += `\n\n> Error: ${event.content}`;
        this.updateAssistantEl(msg, el);
        break;

      case 'done':
        break;
    }
  }

  private renderMessage(msg: ChatMessage): HTMLElement {
    if (!this.messagesEl) return document.createElement('div');

    const el = this.messagesEl.createEl('div', {
      cls: `cassandra-message cassandra-message-${msg.role}`,
    });

    const roleEl = el.createEl('div', { cls: 'cassandra-message-role' });
    roleEl.textContent = msg.role === 'user' ? 'You' : 'Cassandra';

    const contentEl = el.createEl('div', { cls: 'cassandra-message-content' });

    if (msg.role === 'user') {
      contentEl.textContent = msg.content;
    }

    this.scrollToBottom();
    return el;
  }

  private updateAssistantEl(msg: ChatMessage, el: HTMLElement): void {
    const contentEl = el.querySelector('.cassandra-message-content');
    if (!contentEl) return;

    // Clear and re-render
    contentEl.empty();

    // Tool calls
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      const toolsEl = contentEl.createEl('div', { cls: 'cassandra-tools' });
      for (const tc of msg.toolCalls) {
        const tcEl = toolsEl.createEl('div', { cls: `cassandra-tool cassandra-tool-${tc.status}` });
        const statusIcon = tc.status === 'completed' ? '✓' : tc.status === 'error' ? '✗' : '◐';
        tcEl.createEl('span', { cls: 'cassandra-tool-name', text: `${statusIcon} ${tc.name}` });
        if (tc.name === 'Bash' && tc.input?.command) {
          tcEl.createEl('code', { cls: 'cassandra-tool-detail', text: String(tc.input.command).slice(0, 80) });
        } else if (tc.name === 'Read' && tc.input?.file_path) {
          tcEl.createEl('code', { cls: 'cassandra-tool-detail', text: String(tc.input.file_path) });
        } else if ((tc.name === 'Edit' || tc.name === 'Write') && tc.input?.file_path) {
          tcEl.createEl('code', { cls: 'cassandra-tool-detail', text: String(tc.input.file_path) });
        }
      }
    }

    // Markdown content
    if (msg.content) {
      const mdEl = contentEl.createEl('div', { cls: 'cassandra-md' });
      MarkdownRenderer.render(this.app, msg.content, mdEl, '', this);
    }
  }

  private updateStatus(text: string): void {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  private scrollToBottom(): void {
    if (this.messagesEl) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }

  private formatTokens(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }
}
