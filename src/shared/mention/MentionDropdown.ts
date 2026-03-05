/**
 * MentionDropdown — fuzzy-search vault files when user types `@`.
 *
 * Attaches to a textarea, listens for `@` at word boundaries, shows a
 * dropdown of matching vault markdown files. Arrow keys + Enter to select.
 */

import type { App, TFile } from 'obsidian';

export interface MentionDropdownCallbacks {
  onSelect: (filePath: string) => void;
}

export class MentionDropdown {
  private app: App;
  private inputEl: HTMLTextAreaElement;
  private callbacks: MentionDropdownCallbacks;
  private dropdownEl: HTMLElement;
  private items: TFile[] = [];
  private selectedIndex = 0;
  private mentionStart = -1;
  private active = false;

  constructor(app: App, inputEl: HTMLTextAreaElement, parentEl: HTMLElement, callbacks: MentionDropdownCallbacks) {
    this.app = app;
    this.inputEl = inputEl;
    this.callbacks = callbacks;

    this.dropdownEl = parentEl.createEl('div', { cls: 'cassandra-mention-dropdown' });
    this.dropdownEl.style.display = 'none';

    this.inputEl.addEventListener('input', () => this.onInput());
    this.inputEl.addEventListener('keydown', (e) => this.onKeydown(e));
    this.inputEl.addEventListener('blur', () => {
      // Delay so click on dropdown item can fire first
      setTimeout(() => this.close(), 150);
    });
  }

  private onInput(): void {
    const val = this.inputEl.value;
    const pos = this.inputEl.selectionStart ?? 0;

    // Find the @ trigger: must be at word boundary (start of input or after whitespace)
    const beforeCursor = val.slice(0, pos);
    const match = beforeCursor.match(/(^|[\s])@([^\s]*)$/);
    if (!match) {
      this.close();
      return;
    }

    this.mentionStart = beforeCursor.length - match[2].length;
    const query = match[2].toLowerCase();
    this.search(query);
  }

  private search(query: string): void {
    const files = this.app.vault.getMarkdownFiles();
    let filtered: TFile[];

    if (!query) {
      // Show recent files when no query
      filtered = files
        .sort((a, b) => b.stat.mtime - a.stat.mtime)
        .slice(0, 10);
    } else {
      filtered = files
        .filter(f => f.path.toLowerCase().includes(query) || f.basename.toLowerCase().includes(query))
        .sort((a, b) => {
          // Prioritize basename matches
          const aBase = a.basename.toLowerCase().includes(query) ? 0 : 1;
          const bBase = b.basename.toLowerCase().includes(query) ? 0 : 1;
          if (aBase !== bBase) return aBase - bBase;
          return b.stat.mtime - a.stat.mtime;
        })
        .slice(0, 10);
    }

    this.items = filtered;
    this.selectedIndex = 0;

    if (filtered.length === 0) {
      this.close();
      return;
    }

    this.renderDropdown();
    this.active = true;
    this.dropdownEl.style.display = '';
  }

  private renderDropdown(): void {
    this.dropdownEl.empty();
    for (let i = 0; i < this.items.length; i++) {
      const file = this.items[i];
      const item = this.dropdownEl.createEl('div', {
        cls: `cassandra-mention-item${i === this.selectedIndex ? ' is-selected' : ''}`,
      });
      item.createEl('span', { cls: 'cassandra-mention-item-name', text: file.basename });
      if (file.parent && file.parent.path !== '/') {
        item.createEl('span', { cls: 'cassandra-mention-item-path', text: file.parent.path });
      }
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent blur
        this.selectItem(i);
      });
      item.addEventListener('mouseenter', () => {
        this.selectedIndex = i;
        this.updateSelection();
      });
    }
  }

  private updateSelection(): void {
    const children = this.dropdownEl.querySelectorAll('.cassandra-mention-item');
    children.forEach((el, i) => {
      el.classList.toggle('is-selected', i === this.selectedIndex);
    });
  }

  private onKeydown(e: KeyboardEvent): void {
    if (!this.active) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.items.length - 1);
      this.updateSelection();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.updateSelection();
      return;
    }

    if (e.key === 'Enter' || e.key === 'Tab') {
      if (this.items.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        this.selectItem(this.selectedIndex);
        return;
      }
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  private selectItem(index: number): void {
    const file = this.items[index];
    if (!file) return;

    const val = this.inputEl.value;
    const pos = this.inputEl.selectionStart ?? 0;

    // Replace @query with @path/to/file.md
    const before = val.slice(0, this.mentionStart);
    const after = val.slice(pos);
    const mention = `${file.path} `;
    this.inputEl.value = before + mention + after;
    const newPos = before.length + mention.length;
    this.inputEl.setSelectionRange(newPos, newPos);
    this.inputEl.dispatchEvent(new Event('input'));

    this.callbacks.onSelect(file.path);
    this.close();
  }

  close(): void {
    this.active = false;
    this.dropdownEl.style.display = 'none';
    this.items = [];
  }

  isActive(): boolean {
    return this.active;
  }

  destroy(): void {
    this.close();
    this.dropdownEl.remove();
  }
}
