/**
 * FileContextManager — manages attached file mentions and current note context.
 *
 * Handles three types of file attachments:
 * 1. Vault files (@-mentions) — referenced by path, runner reads them via tools
 * 2. External text files (dropped from OS) — contents read inline via FileReader
 * 3. External binary files (PDF, images) — base64 encoded, sent as content blocks
 */

import type { App } from 'obsidian';
import { MarkdownView, Notice, setIcon } from 'obsidian';

import { createLogger } from '../../../core/logging';
import type { UserContentBlock } from '../../../core/runner/types';
import { MentionDropdown } from '../../../shared/mention/MentionDropdown';

const log = createLogger('FileContextManager');

const MAX_TEXT_FILE_SIZE = 1024 * 1024; // 1MB text content limit
const MAX_BINARY_FILE_SIZE = 20 * 1024 * 1024; // 20MB for PDFs/binary

const TEXT_EXTENSIONS = new Set([
  'md', 'txt', 'csv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'toml',
  'html', 'htm', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go',
  'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'sh', 'bash', 'zsh', 'sql',
  'r', 'swift', 'kt', 'scala', 'lua', 'php', 'pl', 'ex', 'exs',
  'env', 'ini', 'cfg', 'conf', 'log', 'diff', 'patch',
]);

const DOCUMENT_TYPES: Record<string, string> = {
  'pdf': 'application/pdf',
};

export interface ExternalTextFile {
  id: string;
  name: string;
  content: string;
  size: number;
}

export interface ExternalDocumentFile {
  id: string;
  name: string;
  base64: string;
  mediaType: string;
  size: number;
}

export interface FileContextCallbacks {
  onFilesChanged: () => void;
}

export class FileContextManager {
  private app: App;
  private contextRowEl: HTMLElement;
  private chipContainer: HTMLElement;
  private mentionDropdown: MentionDropdown;
  private attachedFiles: Set<string> = new Set();
  private externalTextFiles: Map<string, ExternalTextFile> = new Map();
  private externalDocuments: Map<string, ExternalDocumentFile> = new Map();
  private callbacks: FileContextCallbacks;
  private inputEl: HTMLTextAreaElement;
  private currentNotePath: string | null = null;
  private currentNoteSent = false;
  private selectionText: string | null = null;
  private selectionLineCount = 0;
  private selectionPollInterval: ReturnType<typeof setInterval> | null = null;
  private _contextEnabled = true;
  private onContextStateChanged: (() => void) | null = null;

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

    this.inputEl = inputEl;

    this.mentionDropdown = new MentionDropdown(app, inputEl, composerEl, {
      onSelect: (filePath) => this.addFile(filePath),
    });

    // Track active file
    this.updateCurrentNote();
    this.app.workspace.on('active-leaf-change', () => this.updateCurrentNote());

    // Poll for selection changes (Obsidian has no selection-change event)
    this.selectionPollInterval = setInterval(() => this.pollSelection(), 250);
  }

  /** Whether auto-context (current note + selection) is enabled. */
  get contextEnabled(): boolean { return this._contextEnabled; }

  toggleContext(): void {
    this._contextEnabled = !this._contextEnabled;
    this.onContextStateChanged?.();
  }

  /** Register a callback for when context state changes (toggle, note change, selection change). */
  setOnContextStateChanged(cb: () => void): void {
    this.onContextStateChanged = cb;
  }

  /** Get a summary string for the toolbar tooltip. */
  getContextSummary(): string | null {
    if (!this._contextEnabled) return null;
    const parts: string[] = [];
    if (this.currentNotePath) {
      const name = this.currentNotePath.split('/').pop()?.replace(/\.md$/, '') ?? this.currentNotePath;
      parts.push(name);
    }
    if (this.selectionText) {
      const lineWord = this.selectionLineCount === 1 ? 'line' : 'lines';
      parts.push(`${this.selectionLineCount} ${lineWord} selected`);
    }
    return parts.length > 0 ? parts.join(' + ') : null;
  }

  /** Whether there's any auto-context available (note or selection). */
  hasAutoContext(): boolean {
    return !!this.currentNotePath || !!this.selectionText;
  }

  /** Add a vault file by path (from @-mention or Obsidian internal drag). */
  addFile(filePath: string): void {
    if (this.attachedFiles.has(filePath)) return;
    this.attachedFiles.add(filePath);
    this.renderChips();
    this.callbacks.onFilesChanged();
  }

  /** Try to add a dropped file — resolves vault path, reads text, or base64 encodes binary. */
  async addDroppedFile(fileName: string, file?: File): Promise<void> {
    // Try to resolve as a vault file
    // Obsidian drag URLs may omit the .md extension, so try both
    const candidates = this.app.vault.getFiles().filter(f =>
      f.name === fileName || f.path === fileName || f.path === `${fileName}.md`,
    );
    if (candidates.length >= 1) {
      // If multiple matches and we have a File, disambiguate by size
      if (candidates.length > 1 && file) {
        const match = candidates.find(f => f.stat.size === file.size);
        this.addFile((match ?? candidates[0]).path);
      } else {
        this.addFile(candidates[0].path);
      }
      return;
    }

    if (!file) {
      log.warn('dropped_file_not_resolved', { fileName });
      new Notice(`Could not find "${fileName}" in vault`);
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

    // PDF / document files → base64 content block
    if (DOCUMENT_TYPES[ext]) {
      await this.addDocumentFile(file, ext);
      return;
    }

    // Text files → read content inline
    if (TEXT_EXTENSIONS.has(ext)) {
      await this.addTextFile(file);
      return;
    }

    new Notice(`Unsupported file type: .${ext}`);
  }

  private async addTextFile(file: File): Promise<void> {
    if (file.size > MAX_TEXT_FILE_SIZE) {
      new Notice(`File too large (${(file.size / 1024).toFixed(0)}KB). Max 1MB for text files.`);
      return;
    }
    if (this.externalTextFiles.has(file.name)) return;

    try {
      const content = await this.readAsText(file);
      this.externalTextFiles.set(file.name, {
        id: crypto.randomUUID(),
        name: file.name,
        content,
        size: file.size,
      });
      this.renderChips();
      this.callbacks.onFilesChanged();
      log.info('text_file_added', { name: file.name, size: file.size });
    } catch (err) {
      log.warn('text_file_read_failed', { name: file.name, error: String(err) });
      new Notice(`Failed to read file: ${file.name}`);
    }
  }

  private async addDocumentFile(file: File, ext: string): Promise<void> {
    if (file.size > MAX_BINARY_FILE_SIZE) {
      new Notice(`File too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Max 20MB.`);
      return;
    }
    if (this.externalDocuments.has(file.name)) return;

    try {
      const base64 = await this.readAsBase64(file);
      this.externalDocuments.set(file.name, {
        id: crypto.randomUUID(),
        name: file.name,
        base64,
        mediaType: DOCUMENT_TYPES[ext],
        size: file.size,
      });
      this.renderChips();
      this.callbacks.onFilesChanged();
      log.info('document_file_added', { name: file.name, size: file.size, mediaType: DOCUMENT_TYPES[ext] });
    } catch (err) {
      log.warn('document_file_read_failed', { name: file.name, error: String(err) });
      new Notice(`Failed to read file: ${file.name}`);
    }
  }

  removeFile(key: string): void {
    this.attachedFiles.delete(key);
    this.externalTextFiles.delete(key);
    this.externalDocuments.delete(key);
    this.renderChips();
    this.callbacks.onFilesChanged();
  }

  getAttachedFiles(): string[] {
    return Array.from(this.attachedFiles);
  }

  /** Get document content blocks to send alongside the message (PDFs etc). */
  getDocumentContentBlocks(): UserContentBlock[] {
    const blocks: UserContentBlock[] = [];
    for (const doc of this.externalDocuments.values()) {
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: doc.mediaType, data: doc.base64 },
        title: doc.name,
      });
    }
    return blocks;
  }

  /** Build XML context string to prepend to the prompt. */
  getContextXml(): string {
    const parts: string[] = [];

    // Auto-context (current note + selection) — only when enabled
    if (this._contextEnabled) {
      if (this.currentNotePath && !this.currentNoteSent) {
        parts.push(`<current_note>\n${this.currentNotePath}\n</current_note>`);
        this.currentNoteSent = true;
      }

      const selection = this.getEditorSelection();
      if (selection) {
        parts.push(`<selected_text file="${selection.filePath}">\n${selection.text}\n</selected_text>`);
      }
    }

    // Attached vault file mentions (runner reads these via tools)
    if (this.attachedFiles.size > 0) {
      const files = Array.from(this.attachedFiles).map(f => f).join('\n');
      parts.push(`<attached_files>\n${files}\n</attached_files>`);
    }

    // External text file contents (inline, since runner can't access them)
    for (const ext of this.externalTextFiles.values()) {
      parts.push(`<file name="${ext.name}">\n${ext.content}\n</file>`);
    }

    // Document files are sent as content blocks, not XML — but note their names
    if (this.externalDocuments.size > 0) {
      const names = Array.from(this.externalDocuments.values()).map(d => d.name).join(', ');
      parts.push(`<attached_documents>${names}</attached_documents>`);
    }

    return parts.length > 0 ? parts.join('\n') + '\n\n' : '';
  }

  /** Clear attached files after send. */
  clearAfterSend(): void {
    this.attachedFiles.clear();
    this.externalTextFiles.clear();
    this.externalDocuments.clear();
    this.renderChips();
  }

  /** Reset for new conversation. */
  reset(): void {
    this.attachedFiles.clear();
    this.externalTextFiles.clear();
    this.externalDocuments.clear();
    this.currentNoteSent = false;
    this.renderChips();
  }

  private updateCurrentNote(): void {
    const file = this.app.workspace.getActiveFile();
    this.currentNotePath = file ? file.path : null;
    this.onContextStateChanged?.();
  }

  private pollSelection(): void {
    const sel = this.getEditorSelection();

    if (sel?.text.trim()) {
      const lineCount = sel.text.split(/\r?\n/).length;
      if (sel.text !== this.selectionText) {
        this.selectionText = sel.text;
        this.selectionLineCount = lineCount;
        this.onContextStateChanged?.();
      }
    } else if (document.activeElement !== this.inputEl) {
      // No selection AND chat input not focused — user cleared selection in editor
      if (this.selectionText !== null) {
        this.selectionText = null;
        this.selectionLineCount = 0;
        this.onContextStateChanged?.();
      }
    }
    // If no selection but input IS focused, keep stored selection (user clicked input to type)
  }

  private getEditorSelection(): { text: string; filePath: string } | null {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return null;

    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView?.editor) return null;

    const selection = markdownView.editor.getSelection();
    if (!selection?.trim()) return null;

    return { text: selection, filePath: activeFile.path };
  }

  private renderChips(): void {
    this.chipContainer.empty();

    const allChips: Array<{ key: string; displayName: string; badge?: string }> = [];

    for (const filePath of this.attachedFiles) {
      const name = filePath.split('/').pop()?.replace(/\.md$/, '') ?? filePath;
      allChips.push({ key: filePath, displayName: name });
    }
    for (const ext of this.externalTextFiles.values()) {
      allChips.push({ key: ext.name, displayName: ext.name, badge: 'text' });
    }
    for (const doc of this.externalDocuments.values()) {
      allChips.push({ key: doc.name, displayName: doc.name, badge: 'doc' });
    }

    for (const { key, displayName, badge } of allChips) {
      const chip = this.chipContainer.createEl('div', {
        cls: `cassandra-file-chip${badge ? ` is-${badge}` : ''}`,
      });
      chip.createEl('span', { cls: 'cassandra-file-chip-name', text: displayName });
      chip.setAttribute('title', key);

      if (badge) {
        chip.createEl('span', { cls: 'cassandra-file-chip-badge', text: badge.toUpperCase() });
      }

      const removeBtn = chip.createEl('span', { cls: 'cassandra-file-chip-remove' });
      setIcon(removeBtn, 'x');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeFile(key);
      });
    }

    this.updateContextRowVisibility();
  }

  private updateContextRowVisibility(): void {
    const hasImages = this.contextRowEl.querySelector('.cassandra-image-preview')?.children.length ?? 0;
    const hasFiles = this.attachedFiles.size > 0 || this.externalTextFiles.size > 0 || this.externalDocuments.size > 0;
    this.contextRowEl.classList.toggle('has-content', hasFiles || hasImages > 0);
  }

  private readAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  private readAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip data URL prefix: "data:application/pdf;base64,..."
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  destroy(): void {
    this.mentionDropdown.destroy();
    if (this.selectionPollInterval) {
      clearInterval(this.selectionPollInterval);
      this.selectionPollInterval = null;
    }
    this.attachedFiles.clear();
    this.externalTextFiles.clear();
    this.externalDocuments.clear();
  }
}
