/**
 * Polyfills for Obsidian's HTMLElement extensions used throughout the UI layer.
 * Obsidian adds createDiv, createEl, createSpan, setText, empty, addClass,
 * removeClass, setAttribute to HTMLElement in the plugin host. We replicate
 * them here so unit tests running in jsdom can exercise rendering code without
 * loading Obsidian itself.
 */

type CreateElOptions = {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string>;
};

function applyOptions(el: HTMLElement, options: CreateElOptions): void {
  if (options.cls) {
    // Obsidian allows cls to be a space-separated string or an array of strings.
    // classList.add() rejects strings with spaces, so we split each token.
    const rawClasses = Array.isArray(options.cls) ? options.cls : [options.cls];
    for (const raw of rawClasses) {
      for (const token of raw.split(/\s+/)) {
        if (token) el.classList.add(token);
      }
    }
  }
  if (options.text !== undefined) {
    el.textContent = options.text;
  }
  if (options.attr) {
    for (const [k, v] of Object.entries(options.attr)) {
      el.setAttribute(k, v);
    }
  }
}

// Extend HTMLElement prototype with Obsidian helpers
const proto = HTMLElement.prototype as any;

proto.createEl = function <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: CreateElOptions = {}
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag) as HTMLElementTagNameMap[K];
  applyOptions(el as unknown as HTMLElement, options);
  this.appendChild(el);
  return el;
};

proto.createDiv = function (options: CreateElOptions = {}): HTMLDivElement {
  return this.createEl('div', options);
};

proto.createSpan = function (options: CreateElOptions = {}): HTMLSpanElement {
  return this.createEl('span', options);
};

proto.setText = function (text: string): void {
  this.textContent = text;
};

proto.empty = function (): void {
  while (this.firstChild) {
    this.removeChild(this.firstChild);
  }
};

proto.addClass = function (...classes: string[]): void {
  for (const c of classes) {
    for (const token of c.split(/\s+/)) {
      if (token) this.classList.add(token);
    }
  }
};

proto.removeClass = function (...classes: string[]): void {
  for (const c of classes) {
    for (const token of c.split(/\s+/)) {
      if (token) this.classList.remove(token);
    }
  }
};

// Also patch global createEl used in MessageRenderer
(globalThis as any).createEl = function <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: CreateElOptions = {}
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag) as HTMLElementTagNameMap[K];
  applyOptions(el as unknown as HTMLElement, options);
  return el;
};
