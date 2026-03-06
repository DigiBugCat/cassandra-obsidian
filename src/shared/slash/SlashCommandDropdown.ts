/**
 * SlashCommandDropdown — shows available slash commands when user types `/`.
 *
 * Triggers at the start of input (or after newline). Fetches commands from
 * the runner, filters by typed prefix, keyboard nav + Enter to select.
 */

export interface SlashCommand {
  name: string;
  description: string;
  argumentHint: string;
}

export interface SlashCommandDropdownCallbacks {
  getCommands: () => Promise<SlashCommand[]>;
  onSelect: (command: SlashCommand) => void;
}

export class SlashCommandDropdown {
  private inputEl: HTMLTextAreaElement;
  private callbacks: SlashCommandDropdownCallbacks;
  private dropdownEl: HTMLElement;
  private items: SlashCommand[] = [];
  private allCommands: SlashCommand[] = [];
  private selectedIndex = 0;
  private active = false;
  private commandsFetched = false;

  constructor(inputEl: HTMLTextAreaElement, parentEl: HTMLElement, callbacks: SlashCommandDropdownCallbacks) {
    this.inputEl = inputEl;
    this.callbacks = callbacks;

    this.dropdownEl = parentEl.createEl('div', { cls: 'cassandra-slash-dropdown' });
    this.dropdownEl.style.display = 'none';

    this.inputEl.addEventListener('input', () => this.onInput());
    this.inputEl.addEventListener('keydown', (e) => this.onKeydown(e));
    this.inputEl.addEventListener('blur', () => {
      setTimeout(() => this.close(), 150);
    });
  }

  private async onInput(): Promise<void> {
    const val = this.inputEl.value;
    const pos = this.inputEl.selectionStart ?? 0;

    // Only trigger at the very start of input or after a newline
    const beforeCursor = val.slice(0, pos);
    const match = beforeCursor.match(/(^|\n)\/([^\s\n]*)$/);
    if (!match) {
      this.close();
      return;
    }

    const query = match[2].toLowerCase();

    // Fetch commands lazily on first trigger
    if (!this.commandsFetched) {
      this.commandsFetched = true;
      this.allCommands = await this.callbacks.getCommands();
    }

    this.filter(query);
  }

  private filter(query: string): void {
    let filtered: SlashCommand[];

    if (!query) {
      filtered = this.allCommands.slice(0, 15);
    } else {
      filtered = this.allCommands
        .filter(c => c.name.toLowerCase().includes(query) || c.description.toLowerCase().includes(query))
        .slice(0, 15);
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
      const cmd = this.items[i];
      const item = this.dropdownEl.createEl('div', {
        cls: `cassandra-slash-item${i === this.selectedIndex ? ' is-selected' : ''}`,
      });
      const nameRow = item.createEl('div', { cls: 'cassandra-slash-item-name' });
      nameRow.createEl('span', { text: `/${cmd.name}` });
      if (cmd.argumentHint) {
        nameRow.createEl('span', { cls: 'cassandra-slash-item-hint', text: ` ${cmd.argumentHint}` });
      }
      item.createEl('div', { cls: 'cassandra-slash-item-desc', text: cmd.description });

      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.selectItem(i);
      });
      item.addEventListener('mouseenter', () => {
        this.selectedIndex = i;
        this.updateSelection();
      });
    }
  }

  private updateSelection(): void {
    const children = this.dropdownEl.querySelectorAll('.cassandra-slash-item');
    children.forEach((el, i) => {
      el.classList.toggle('is-selected', i === this.selectedIndex);
    });
  }

  private onKeydown(e: KeyboardEvent): void {
    if (!this.active) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.items.length - 1);
      this.updateSelection();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.updateSelection();
      return;
    }

    if (e.key === 'Enter' || e.key === 'Tab') {
      if (this.items.length > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.selectItem(this.selectedIndex);
        return;
      }
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.close();
    }
  }

  private selectItem(index: number): void {
    const cmd = this.items[index];
    if (!cmd) return;

    const val = this.inputEl.value;
    const pos = this.inputEl.selectionStart ?? 0;

    // Find the / that started this command
    const beforeCursor = val.slice(0, pos);
    const match = beforeCursor.match(/(^|\n)(\/[^\s\n]*)$/);
    if (!match) return;

    const slashStart = pos - match[2].length;
    const after = val.slice(pos);
    const replacement = `/${cmd.name} `;
    this.inputEl.value = val.slice(0, slashStart) + replacement + after;
    const newPos = slashStart + replacement.length;
    this.inputEl.setSelectionRange(newPos, newPos);
    this.inputEl.dispatchEvent(new Event('input'));

    this.callbacks.onSelect(cmd);
    this.close();
  }

  /** Invalidate cached commands (e.g. on session change). */
  invalidateCache(): void {
    this.commandsFetched = false;
    this.allCommands = [];
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
