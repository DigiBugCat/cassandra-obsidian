/**
 * FileContextManager — manages attached file mentions and current note context.
 *
 * Handles two types of file attachments:
 * 1. Vault files (@-mentions) — referenced by path, runner reads them via tools
 * 2. External files (dropped from OS) — contents read inline via FileReader
 */

import type { App } from 'obsidian';
import { Notice, setIcon } from 'obsidian';

import { createLogger } from '../../../core/logging';
import { MentionDropdown } from '../../../shared/mention/MentionDropdown';

const log = createLogger('FileContextManager');

const MAX_EXTERNAL_FILE_SIZE = 1024 * 1024; // 1MB text content limit
const READABLE_EXTENSIONS = new Set([
  'md', 'txt', 'csv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'toml',
  'html', 'htm', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go',
  'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'sh', 'bash', 'zsh', 'sql',
  'r', 'swift', 'kt', 'scala', 'lua', 'php', 'pl', 'ex', 'exs',
  'env', 'ini', 'cfg', 'conf', 'log', 'diff', 'patch',
]);

export interface ExternalFileAttachment {
  id: string;
  name: string;
  content: string;
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
  private externalFiles: Map<string, ExternalFileAttachment> = new Map();
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

  /** Add a vault file by path (from @-mention or Obsidian internal drag). */
  addFile(filePath: string): void {
    if (this.attachedFiles.has(filePath)) return;
    this.attachedFiles.add(filePath);
    this.renderChips();
    this.callbacks.onFilesChanged();
  }

  /** Add an external file dropped from OS — reads content via FileReader. */
  async addExternalFile(file: File): Promise<void> {
    // Check extension
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!READABLE_EXTENSIONS.has(ext)) {
      new Notice(`Unsupported file type: .${ext}`);
      return;
    }

    if (file.size > MAX_EXTERNAL_FILE_SIZE) {
      new Notice(`File too large (${(file.size / 1024).toFixed(0)}KB). Max 1MB for text files.`);
      return;
    }

    // Check for duplicate
    if (this.externalFiles.has(file.name)) return;

    try {
      const content = await this.readFileAsText(file);
      const attachment: ExternalFileAttachment = {
        id: crypto.randomUUID(),
        name: file.name,
        content,
        size: file.size,
      };
      this.externalFiles.set(file.name, attachment);
      this.renderChips();
      this.callbacks.onFilesChanged();
      log.info('external_file_added', { name: file.name, size: file.size, contentLength: content.length });
    } catch (err) {
      log.warn('external_file_read_failed', { name: file.name, error: String(err) });
      new Notice(`Failed to read file: ${file.name}`);
    }
  }

  /** Try to add a dropped file — resolves vault path or reads external content. */
  async addDroppedFile(fileName: string, file?: File): Promise<void> {
    // First, try to resolve as a vault file
    const vaultFile = this.app.vault.getFiles().find(f =>
      f.name === fileName || f.path === fileName,
    );
    if (vaultFile) {
      this.addFile(vaultFile.path);
      return;
    }

    // External file — read contents
    if (file) {
      await this.addExternalFile(file);
      return;
    }

    // No File object and not in vault — can't do anything
    log.warn('dropped_file_not_resolved', { fileName });
    new Notice(`Could not find "${fileName}" in vault`);
  }

  removeFile(filePath: string): void {
    this.attachedFiles.delete(filePath);
    this.externalFiles.delete(filePath);
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

    // Attached vault file mentions (runner reads these via tools)
    if (this.attachedFiles.size > 0) {
      const files = Array.from(this.attachedFiles).map(f => f).join('\n');
      parts.push(`<attached_files>\n${files}\n</attached_files>`);
    }

    // External file contents (inline, since runner can't access them)
    for (const ext of this.externalFiles.values()) {
      parts.push(`<file name="${ext.name}">\n${ext.content}\n</file>`);
    }

    return parts.length > 0 ? parts.join('\n') + '\n\n' : '';
  }

  /** Clear attached files after send. */
  clearAfterSend(): void {
    this.attachedFiles.clear();
    this.externalFiles.clear();
    this.renderChips();
  }

  /** Reset for new conversation. */
  reset(): void {
    this.attachedFiles.clear();
    this.externalFiles.clear();
    this.currentNoteSent = false;
    this.renderChips();
  }

  private updateCurrentNote(): void {
    const file = this.app.workspace.getActiveFile();
    this.currentNotePath = file ? file.path : null;
  }

  private renderChips(): void {
    this.chipContainer.empty();

    const allNames: Array<{ key: string; displayName: string; isExternal: boolean }> = [];

    for (const filePath of this.attachedFiles) {
      const name = filePath.split('/').pop()?.replace(/\.md$/, '') ?? filePath;
      allNames.push({ key: filePath, displayName: name, isExternal: false });
    }

    for (const ext of this.externalFiles.values()) {
      allNames.push({ key: ext.name, displayName: ext.name, isExternal: true });
    }

    if (allNames.length === 0) {
      this.updateContextRowVisibility();
      return;
    }

    for (const { key, displayName, isExternal } of allNames) {
      const chip = this.chipContainer.createEl('div', {
        cls: `cassandra-file-chip${isExternal ? ' is-external' : ''}`,
      });
      chip.createEl('span', { cls: 'cassandra-file-chip-name', text: displayName });
      chip.setAttribute('title', isExternal ? `External: ${key}` : key);

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
    const hasFiles = this.attachedFiles.size > 0 || this.externalFiles.size > 0;
    this.contextRowEl.classList.toggle('has-content', hasFiles || hasImages > 0);
  }

  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  destroy(): void {
    this.mentionDropdown.destroy();
    this.attachedFiles.clear();
    this.externalFiles.clear();
  }
}
