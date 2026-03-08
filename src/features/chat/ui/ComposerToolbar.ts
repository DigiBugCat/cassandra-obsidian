/**
 * ComposerToolbar — bottom toolbar for the composer.
 *
 * Layout: Model → Thinking → Token count
 * Hover dropdowns for model selector with click fallback for mobile.
 */

import { setIcon } from 'obsidian';

import type { ThinkingBudget, UsageInfo } from '../../../core/types';
import { DEFAULT_CLAUDE_MODELS } from '../../../core/types';

// ── Types ──────────────────────────────────────────────────────

export interface ComposerToolbarCallbacks {
  onModelChange: (model: string) => void;
  onThinkingChange: (budget: ThinkingBudget) => void;
  onContextToggle?: () => void;
}

export interface ComposerToolbarState {
  model: string;
  thinkingBudget: ThinkingBudget;
  isStreaming: boolean;
  isReady: boolean;
  usage: UsageInfo | null;
  contextEnabled?: boolean;
  contextSummary?: string | null;
  hasAutoContext?: boolean;
}

// ── Component ──────────────────────────────────────────────────

export class ComposerToolbar {
  private el: HTMLElement;
  private callbacks: ComposerToolbarCallbacks;
  private state: ComposerToolbarState;

  // Sub-components
  private modelBtn: HTMLElement;
  private modelDropdown: HTMLElement;
  private thinkingToggle: HTMLElement;
  private contextToggle: HTMLElement;
  private contextLabel: HTMLElement;
  private tokenContainer: HTMLElement;
  private tokenContext: HTMLElement;
  private tokenOutput: HTMLElement;
  private documentClickHandler: () => void;

  constructor(parentEl: HTMLElement, callbacks: ComposerToolbarCallbacks, initialState: ComposerToolbarState) {
    this.callbacks = callbacks;
    this.state = { ...initialState };

    this.el = parentEl.createEl('div', { cls: 'cassandra-input-toolbar' });

    // ── Model selector ──
    const modelSelector = this.el.createEl('div', { cls: 'cassandra-model-selector' });
    this.modelBtn = modelSelector.createEl('div', { cls: 'cassandra-model-btn' });
    this.modelDropdown = modelSelector.createEl('div', { cls: 'cassandra-model-dropdown' });

    // Click-to-toggle for touch devices (hover doesn't work on mobile)
    this.modelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = modelSelector.hasClass('is-open');
      modelSelector.toggleClass('is-open', !isOpen);
    });
    this.documentClickHandler = () => modelSelector.removeClass('is-open');
    document.addEventListener('click', this.documentClickHandler);

    // ── Thinking toggle (off ↔ medium) ──
    this.thinkingToggle = this.el.createEl('div', { cls: 'cassandra-thinking-toggle' });
    this.thinkingToggle.addEventListener('click', () => {
      const next: ThinkingBudget = this.state.thinkingBudget === 'off' ? 'medium' : 'off';
      callbacks.onThinkingChange(next);
    });

    // ── Context toggle (current note + selection) ──
    const contextContainer = this.el.createEl('div', { cls: 'cassandra-context-toggle' });
    this.contextToggle = contextContainer.createEl('div', { cls: 'cassandra-context-toggle-icon' });
    this.contextLabel = contextContainer.createEl('span', { cls: 'cassandra-context-toggle-label' });
    contextContainer.addEventListener('click', () => callbacks.onContextToggle?.());

    // ── Token count ──
    this.tokenContainer = this.el.createEl('div', { cls: 'cassandra-token-count' });
    this.tokenContext = this.tokenContainer.createEl('span', { cls: 'cassandra-token-context' });
    this.tokenOutput = this.tokenContainer.createEl('span', { cls: 'cassandra-token-output' });
    this.tokenOutput.style.display = 'none';
    this.tokenContainer.style.display = 'none';

    // Initial render
    this.render();
  }

  update(partial: Partial<ComposerToolbarState>): void {
    Object.assign(this.state, partial);
    this.render();
  }

  setReady(ready: boolean): void {
    this.state.isReady = ready;
    this.modelBtn.toggleClass('ready', ready);
  }

  destroy(): void {
    document.removeEventListener('click', this.documentClickHandler);
    this.el.remove();
  }

  // ── Rendering ──────────────────────────────────────────────────

  private render(): void {
    this.renderModelSelector();
    this.renderThinkingToggle();
    this.renderContextToggle();
    this.renderTokenCount();
    this.modelBtn.toggleClass('ready', this.state.isReady);
  }

  private renderModelSelector(): void {
    const { model } = this.state;

    // Button
    this.modelBtn.empty();
    const modelInfo = DEFAULT_CLAUDE_MODELS.find(m => m.value === model);
    this.modelBtn.createEl('span', { cls: 'cassandra-model-label', text: modelInfo?.label ?? model });
    this.modelBtn.createEl('span', { cls: 'cassandra-backend-badge', text: 'RUNNER' });

    // Dropdown options
    this.modelDropdown.empty();
    for (const m of DEFAULT_CLAUDE_MODELS) {
      const option = this.modelDropdown.createEl('div', { cls: 'cassandra-model-option' });
      option.createEl('span', { text: m.label });
      if (m.description) option.setAttribute('title', m.description);
      if (m.value === model) option.addClass('selected');

      option.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onModelChange(m.value);
        this.modelBtn.closest('.cassandra-model-selector')?.removeClass('is-open');
      });
    }
  }

  private renderThinkingToggle(): void {
    const isOn = this.state.thinkingBudget !== 'off';
    this.thinkingToggle.empty();
    setIcon(this.thinkingToggle, 'brain');
    this.thinkingToggle.toggleClass('is-active', isOn);
    this.thinkingToggle.setAttribute('title', isOn ? 'Thinking: On (click to disable)' : 'Thinking: Off (click to enable)');
  }

  private renderContextToggle(): void {
    const enabled = this.state.contextEnabled !== false;
    const summary = this.state.contextSummary;
    const hasContext = this.state.hasAutoContext;
    const container = this.contextToggle.parentElement!;

    this.contextToggle.empty();
    setIcon(this.contextToggle, 'file-symlink');
    container.toggleClass('is-active', enabled && !!hasContext);
    container.toggleClass('is-disabled', !enabled);

    if (enabled && summary) {
      this.contextLabel.textContent = summary;
      this.contextLabel.style.display = '';
    } else {
      this.contextLabel.style.display = 'none';
    }

    const tooltip = enabled
      ? (summary ? `Context: ${summary} (click to disable)` : 'Context: No active note (click to disable)')
      : 'Context: Off (click to enable)';
    container.setAttribute('title', tooltip);
  }

  private renderTokenCount(): void {
    const { usage } = this.state;

    if (!usage || usage.contextTokens <= 0) {
      this.tokenContainer.style.display = 'none';
      return;
    }

    this.tokenContainer.style.display = 'flex';
    this.tokenContext.textContent = this.formatTokens(usage.contextTokens);

    if (usage.outputTokens > 0) {
      this.tokenOutput.textContent = `↑ ${this.formatTokens(usage.outputTokens)}`;
      this.tokenOutput.style.display = '';
    } else {
      this.tokenOutput.style.display = 'none';
    }

    // Warning state
    this.tokenContainer.toggleClass('warning', usage.percentage > 80);

    // Tooltip
    let tooltip = `${this.formatTokens(usage.contextTokens)} / ${this.formatTokens(usage.contextWindow)} context`;
    if (usage.outputTokens > 0) tooltip += ` · ${this.formatTokens(usage.outputTokens)} output`;
    if (usage.percentage > 80) tooltip += ' (Approaching limit)';
    this.tokenContainer.setAttribute('data-tooltip', tooltip);
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1000) {
      const k = tokens / 1000;
      return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
    }
    return String(tokens);
  }
}
