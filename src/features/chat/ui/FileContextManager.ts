/**
 * FileContextManager — manages attached file mentions and current note context.
 *
 * Tracks @-mentioned vault files as chips in the context row, and tracks the
 * active note for automatic context injection on the first message.
 *
 * Files are referenced by vault-relative paths only — the runner reads them.
 */

import type { App } from 'obsidian';
import { setIcon } from 'obsidian';

import { MentionDropdown } from '../../../shared/mention/MentionDropdown';

export interface FileContextCallbacks {
  onFilesChanged: () => void;
}

export class FileContextManager {
  private app: App;
  private contextRowEl: HTMLElement;
  private chipContainer: HTMLElement;
  private mentionDropdown: MentionDropdown;
  private attachedFiles: Set<string> = new Set();
  private callbacks: FileContextCallbacks;
  private currentNotePath: string | null = null;
  private currentNoteSent = false;

  constructor(
    app: App,
    composerEl: HTMLElement,
    contextRowEl: HTMLElement,
    inputEl: HTMLTextAreaElement,
    callbacks: FileContextCallbacks,
  ) {
    this.app = app;
    this.contextRowEl = contextRowEl;
    this.callbacks = callbacks;
    this.chipContainer = contextRowEl.createEl('div', { cls: 'cassandra-file-chips' });

    this.mentionDropdown = new MentionDropdown(app, inputEl, composerEl, {
      onSelect: (filePath) => this.addFile(filePath),
    });

    // Track active file
    this.updateCurrentNote();
    this.app.workspace.on('active-leaf-change', () => this.updateCurrentNote());
  }

  addFile(filePath: string): void {
    if (this.attachedFiles.has(filePath)) return;
    this.attachedFiles.add(filePath);
    this.renderChips();
    this.callbacks.onFilesChanged();
  }

  removeFile(filePath: string): void {
    this.attachedFiles.delete(filePath);
    this.renderChips();
    this.callbacks.onFilesChanged();
  }

  getAttachedFiles(): string[] {
    return Array.from(this.attachedFiles);
  }

  /** Build XML context string to prepend to the prompt. */
  getContextXml(): string {
    const parts: string[] = [];

    // Current note context (only on first message of session)
    if (this.currentNotePath && !this.currentNoteSent) {
      parts.push(`<current_note>\n${this.currentNotePath}\n</current_note>`);
      this.currentNoteSent = true;
    }

    // Attached file mentions
    if (this.attachedFiles.size > 0) {
      const files = Array.from(this.attachedFiles).map(f => f).join('\n');
      parts.push(`<attached_files>\n${files}\n</attached_files>`);
    }

    return parts.length > 0 ? parts.join('\n') + '\n\n' : '';
  }

  /** Clear attached files after send. */
  clearAfterSend(): void {
    this.attachedFiles.clear();
    this.renderChips();
  }

  /** Reset for new conversation. */
  reset(): void {
    this.attachedFiles.clear();
    this.currentNoteSent = false;
    this.renderChips();
  }

  private updateCurrentNote(): void {
    const file = this.app.workspace.getActiveFile();
    this.currentNotePath = file ? file.path : null;
  }

  private renderChips(): void {
    this.chipContainer.empty();

    if (this.attachedFiles.size === 0) {
      this.updateContextRowVisibility();
      return;
    }

    for (const filePath of this.attachedFiles) {
      const chip = this.chipContainer.createEl('div', { cls: 'cassandra-file-chip' });
      const name = filePath.split('/').pop()?.replace(/\.md$/, '') ?? filePath;
      chip.createEl('span', { cls: 'cassandra-file-chip-name', text: name });
      chip.setAttribute('title', filePath);

      const removeBtn = chip.createEl('span', { cls: 'cassandra-file-chip-remove' });
      setIcon(removeBtn, 'x');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeFile(filePath);
      });
    }

    this.updateContextRowVisibility();
  }

  private updateContextRowVisibility(): void {
    const hasImages = this.contextRowEl.querySelector('.cassandra-image-preview')?.children.length ?? 0;
    const hasFiles = this.attachedFiles.size > 0;
    this.contextRowEl.classList.toggle('has-content', hasFiles || hasImages > 0);
  }

  destroy(): void {
    this.mentionDropdown.destroy();
    this.attachedFiles.clear();
  }
}
