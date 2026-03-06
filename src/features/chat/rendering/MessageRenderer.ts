import type { App, Component } from 'obsidian';
import { MarkdownRenderer, Menu, Notice } from 'obsidian';

import type { ChatMessage } from '../../../core/types';
import { findRewindContext } from '../rewind';

export interface RenderDeps {
  app: App;
  component: Component;
}

export interface MessageActionCallbacks {
  onRewind?: (messageId: string) => Promise<void>;
  onFork?: (messageId: string) => Promise<void>;
  getMessages?: () => ChatMessage[];
}

export class MessageRenderer {
  private deps: RenderDeps;
  private messagesEl: HTMLElement;
  private actionCallbacks: MessageActionCallbacks;

  constructor(deps: RenderDeps, messagesEl: HTMLElement, actionCallbacks: MessageActionCallbacks = {}) {
    this.deps = deps;
    this.messagesEl = messagesEl;
    this.actionCallbacks = actionCallbacks;

    // Delegated context menu handler for message actions
    this.messagesEl.addEventListener('contextmenu', (e) => this.handleContextMenu(e));
  }

  // ============================================
  // Message DOM
  // ============================================

  addMessage(msg: ChatMessage): HTMLElement {
    const msgEl = this.messagesEl.createDiv({
      cls: `cassandra-message cassandra-message-${msg.role}`,
      attr: {
        'data-message-id': msg.id,
        'data-role': msg.role,
      },
    });

    const roleLabel = msgEl.createDiv({ cls: 'cassandra-message-role' });
    roleLabel.setText(msg.role === 'user' ? 'You' : 'Claude');

    const contentEl = msgEl.createDiv({
      cls: 'cassandra-message-content',
      attr: { dir: 'auto' },
    });

    if (msg.role === 'user') {
      // Render attached images as inline thumbnails
      if (msg.images && msg.images.length > 0) {
        const imagesRow = contentEl.createDiv({ cls: 'cassandra-message-images' });
        for (const img of msg.images) {
          const thumb = imagesRow.createEl('img', {
            cls: 'cassandra-message-image-thumb',
            attr: { src: `data:${img.mediaType};base64,${img.data}`, alt: img.name },
          });
          thumb.style.maxWidth = '120px';
          thumb.style.maxHeight = '120px';
        }
      }

      const text = msg.displayContent ?? msg.content;
      if (text) {
        contentEl.createDiv({ cls: 'cassandra-user-text', text });
      }
    }
    // Assistant content div is intentionally empty — StreamController populates it.

    this.scrollToBottom();
    return msgEl;
  }

  // ============================================
  // Content Rendering
  // ============================================

  async renderContent(el: HTMLElement, markdown: string): Promise<void> {
    // Render into a detached container first, then swap in atomically
    // to avoid the flash of empty content between el.empty() and render completion.
    const staging = createEl('div');

    try {
      await MarkdownRenderer.render(
        this.deps.app,
        markdown,
        staging,
        '',
        this.deps.component,
      );

      staging.querySelectorAll('pre').forEach((pre) => {
        if (pre.parentElement?.classList.contains('cassandra-code-wrapper')) return;

        const wrapper = createEl('div', { cls: 'cassandra-code-wrapper' });
        pre.parentElement?.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        const code = pre.querySelector('code[class*="language-"]');
        if (code) {
          const match = code.className.match(/language-(\w+)/);
          if (match) {
            wrapper.classList.add('has-language');
            const label = createEl('span', {
              cls: 'cassandra-code-lang-label',
              text: match[1],
            });
            wrapper.appendChild(label);
            label.addEventListener('click', async () => {
              try {
                await navigator.clipboard.writeText(code.textContent ?? '');
                label.setText('copied!');
                setTimeout(() => label.setText(match[1]), 1500);
              } catch { /* non-secure context */ }
            });
          }
        }

        const copyBtn = pre.querySelector('.copy-code-button');
        if (copyBtn) {
          wrapper.appendChild(copyBtn);
        }
      });

      // Atomic swap: replace old content in one operation
      el.empty();
      while (staging.firstChild) {
        el.appendChild(staging.firstChild);
      }
    } catch {
      el.empty();
      el.createDiv({
        cls: 'cassandra-render-error',
        text: 'Failed to render message content.',
      });
    }
  }

  // ============================================
  // Copy Button
  // ============================================

  private static readonly COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

  addTextCopyButton(textEl: HTMLElement, markdown: string): void {
    const copyBtn = textEl.createSpan({ cls: 'cassandra-text-copy-btn' });
    copyBtn.innerHTML = MessageRenderer.COPY_ICON;

    let feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(markdown);
      } catch {
        return;
      }
      if (feedbackTimeout) clearTimeout(feedbackTimeout);
      copyBtn.innerHTML = '';
      copyBtn.setText('copied!');
      copyBtn.classList.add('copied');
      feedbackTimeout = setTimeout(() => {
        copyBtn.innerHTML = MessageRenderer.COPY_ICON;
        copyBtn.classList.remove('copied');
        feedbackTimeout = null;
      }, 1500);
    });
  }

  // ============================================
  // Context Menu
  // ============================================

  private handleContextMenu(e: MouseEvent): void {
    const target = e.target as HTMLElement;

    if (
      target.closest('.cassandra-text-copy-btn') ||
      target.closest('.cassandra-code-wrapper')
    ) {
      return;
    }

    const msgEl = target.closest(
      '.cassandra-message[data-message-id][data-role]',
    ) as HTMLElement | null;
    if (!msgEl) return;

    const doc = typeof activeDocument !== 'undefined' ? activeDocument : document;
    const selection = doc?.getSelection?.();
    if (selection && selection.toString().trim().length > 0) {
      return;
    }

    const messageId = msgEl.getAttribute('data-message-id');
    const role = msgEl.getAttribute('data-role');
    if (!messageId || !role) return;

    const menu = new Menu();
    let hasItems = false;
    const messages = this.actionCallbacks.getMessages?.() ?? [];
    const msgIndex = messages.findIndex(m => m.id === messageId);
    const msg = msgIndex >= 0 ? messages[msgIndex] : null;

    // ── Assistant actions ──
    if (role === 'assistant') {
      const textBlocks = msgEl.querySelectorAll<HTMLElement>('.cassandra-text-block');
      const parts: string[] = [];
      textBlocks.forEach((block) => {
        const text = block.textContent?.trim();
        if (text) parts.push(text);
      });

      if (parts.length > 0) {
        const fullText = parts.join('\n\n');
        menu.addItem((item) => {
          item.setTitle('Copy text');
          item.setIcon('copy');
          item.onClick(() => {
            void navigator.clipboard.writeText(fullText).catch(() => {
              new Notice('Failed to copy to clipboard.');
            });
          });
        });
        hasItems = true;
      }
    }

    // ── User message actions ──
    if (role === 'user' && msg) {
      // Copy user message
      menu.addItem((item) => {
        item.setTitle('Copy message');
        item.setIcon('copy');
        item.onClick(() => {
          void navigator.clipboard.writeText(msg.content).catch(() => {
            new Notice('Failed to copy to clipboard.');
          });
        });
      });
      hasItems = true;

      // Rewind
      if (msg.sdkUserUuid && this.isRewindEligible(messages, msgIndex) && this.actionCallbacks.onRewind) {
        const rewindCb = this.actionCallbacks.onRewind;
        menu.addItem((item) => {
          item.setTitle('Rewind to here');
          item.setIcon('rotate-ccw');
          item.onClick(() => {
            void rewindCb(messageId).catch((err: unknown) => {
              new Notice(`Rewind failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
            });
          });
        });
      }

      // Fork
      if (msg.sdkUserUuid && this.actionCallbacks.onFork) {
        const forkCb = this.actionCallbacks.onFork;
        menu.addItem((item) => {
          item.setTitle('Fork from here');
          item.setIcon('git-branch');
          item.onClick(() => {
            void forkCb(messageId).catch((err: unknown) => {
              new Notice(`Fork failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
            });
          });
        });
      }
    }

    if (hasItems) {
      e.preventDefault();
      menu.showAtMouseEvent(e);
    }
  }

  private isRewindEligible(allMessages: ChatMessage[], index: number): boolean {
    const ctx = findRewindContext(allMessages, index);
    return !!ctx.prevAssistantUuid && ctx.hasResponse;
  }

  // ============================================
  // Scroll
  // ============================================

  scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  scrollToBottomIfNeeded(threshold = 100): void {
    const { scrollTop, scrollHeight, clientHeight } = this.messagesEl;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < threshold;
    if (isNearBottom) {
      requestAnimationFrame(() => {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      });
    }
  }
}
