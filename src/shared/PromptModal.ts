import { type App, Modal, Setting } from 'obsidian';

/**
 * Prompts the user for a text value using an Obsidian modal.
 * Returns the trimmed input string, or null if cancelled.
 */
export function promptText(
  app: App,
  title: string,
  placeholder?: string,
  initialValue?: string,
): Promise<string | null> {
  return new Promise(resolve => {
    new PromptModal(app, title, resolve, placeholder, initialValue).open();
  });
}

class PromptModal extends Modal {
  private resolve: (value: string | null) => void;
  private resolved = false;
  private title: string;
  private placeholder: string;
  private initialValue: string;

  constructor(
    app: App,
    title: string,
    resolve: (value: string | null) => void,
    placeholder?: string,
    initialValue?: string,
  ) {
    super(app);
    this.title = title;
    this.resolve = resolve;
    this.placeholder = placeholder ?? '';
    this.initialValue = initialValue ?? '';
  }

  onOpen() {
    this.setTitle(this.title);

    let inputValue = this.initialValue;

    const inputSetting = new Setting(this.contentEl);
    inputSetting.addText(text => {
      text
        .setPlaceholder(this.placeholder)
        .setValue(this.initialValue)
        .onChange(v => { inputValue = v; });

      // Submit on Enter
      text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.submit(inputValue);
        }
      });

      // Auto-focus and select all
      setTimeout(() => {
        text.inputEl.focus();
        text.inputEl.select();
      }, 0);
    });

    new Setting(this.contentEl)
      .addButton(btn =>
        btn
          .setButtonText('Cancel')
          .onClick(() => this.close())
      )
      .addButton(btn =>
        btn
          .setButtonText('OK')
          .setCta()
          .onClick(() => this.submit(inputValue))
      );
  }

  private submit(value: string): void {
    const trimmed = value.trim();
    if (!trimmed) {
      this.close();
      return;
    }
    this.resolved = true;
    this.resolve(trimmed);
    this.close();
  }

  onClose() {
    if (!this.resolved) {
      this.resolve(null);
    }
    this.contentEl.empty();
  }
}
