/**
 * ComposerToolbar — bottom toolbar for the composer.
 *
 * Ported from Claudian's InputToolbar with cassandra- prefix.
 * Layout: Model → Thinking → Token count → Refresh → Vault restriction → Permission toggle
 *
 * Uses Obsidian's setIcon for icons. Hover dropdowns for model/thinking (matches Claudian).
 * Permission toggle is a Safe/YOLO switch (matches Claudian).
 */

import { setIcon } from 'obsidian';

import type { PermissionMode, ThinkingBudget, UsageInfo } from '../../../core/types';
import { DEFAULT_CLAUDE_MODELS, THINKING_BUDGETS } from '../../../core/types';

// ── Types ──────────────────────────────────────────────────────

export interface ComposerToolbarCallbacks {
  onModelChange: (model: string) => void;
  onThinkingChange: (budget: ThinkingBudget) => void;
  onPermissionModeChange: (mode: PermissionMode) => void;
  onVaultRestrictionChange: (enabled: boolean) => void;
  onRefreshSession: () => void;
}

export interface ComposerToolbarState {
  model: string;
  thinkingBudget: ThinkingBudget;
  permissionMode: PermissionMode;
  vaultRestriction: boolean;
  isStreaming: boolean;
  isReady: boolean;
  usage: UsageInfo | null;
}

// ── Component ──────────────────────────────────────────────────

export class ComposerToolbar {
  private el: HTMLElement;
  private callbacks: ComposerToolbarCallbacks;
  private state: ComposerToolbarState;

  // Sub-components
  private modelBtn: HTMLElement;
  private modelDropdown: HTMLElement;
  private thinkingCurrent: HTMLElement;
  private thinkingOptions: HTMLElement;
  private tokenContainer: HTMLElement;
  private tokenContext: HTMLElement;
  private tokenOutput: HTMLElement;
  private refreshIcon: HTMLElement;
  private vaultIcon: HTMLElement;
  private permissionLabel: HTMLElement;
  private toggleSwitch: HTMLElement;

  constructor(parentEl: HTMLElement, callbacks: ComposerToolbarCallbacks, initialState: ComposerToolbarState) {
    this.callbacks = callbacks;
    this.state = { ...initialState };

    this.el = parentEl.createEl('div', { cls: 'cassandra-input-toolbar' });

    // ── Model selector ──
    const modelSelector = this.el.createEl('div', { cls: 'cassandra-model-selector' });
    this.modelBtn = modelSelector.createEl('div', { cls: 'cassandra-model-btn' });
    this.modelDropdown = modelSelector.createEl('div', { cls: 'cassandra-model-dropdown' });

    // ── Thinking selector ──
    const thinkingSelector = this.el.createEl('div', { cls: 'cassandra-thinking-selector' });
    thinkingSelector.createEl('span', { cls: 'cassandra-thinking-label-text', text: 'Thinking:' });
    const thinkingGears = thinkingSelector.createEl('div', { cls: 'cassandra-thinking-gears' });
    this.thinkingCurrent = thinkingGears.createEl('div', { cls: 'cassandra-thinking-current' });
    this.thinkingOptions = thinkingGears.createEl('div', { cls: 'cassandra-thinking-options' });

    // ── Token count ──
    this.tokenContainer = this.el.createEl('div', { cls: 'cassandra-token-count' });
    this.tokenContext = this.tokenContainer.createEl('span', { cls: 'cassandra-token-context' });
    this.tokenOutput = this.tokenContainer.createEl('span', { cls: 'cassandra-token-output' });
    this.tokenOutput.style.display = 'none';
    this.tokenContainer.style.display = 'none';

    // ── Refresh session ──
    const refreshContainer = this.el.createEl('div', { cls: 'cassandra-refresh-session' });
    this.refreshIcon = refreshContainer.createEl('div', { cls: 'cassandra-refresh-session-icon' });
    setIcon(this.refreshIcon, 'refresh-cw');
    this.refreshIcon.setAttribute('title', 'Refresh session (restart CLI)');
    this.refreshIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onRefreshSession();
    });

    // ── Vault restriction toggle ──
    const vaultContainer = this.el.createEl('div', { cls: 'cassandra-vault-restriction-toggle' });
    this.vaultIcon = vaultContainer.createEl('div', { cls: 'cassandra-vault-restriction-icon' });
    setIcon(this.vaultIcon, 'shield');
    this.vaultIcon.addEventListener('click', () => {
      callbacks.onVaultRestrictionChange(!this.state.vaultRestriction);
    });

    // ── Permission toggle (pushed right via margin-left: auto) ──
    const permissionToggle = this.el.createEl('div', { cls: 'cassandra-permission-toggle' });
    this.permissionLabel = permissionToggle.createEl('span', { cls: 'cassandra-permission-label' });
    this.toggleSwitch = permissionToggle.createEl('div', { cls: 'cassandra-toggle-switch' });
    this.toggleSwitch.addEventListener('click', () => {
      const current = this.state.permissionMode;
      const next: PermissionMode = current === 'bypassPermissions' ? 'default' : 'bypassPermissions';
      callbacks.onPermissionModeChange(next);
    });

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

  setRefreshing(refreshing: boolean): void {
    this.refreshIcon.toggleClass('is-refreshing', refreshing);
  }

  destroy(): void {
    this.el.remove();
  }

  // ── Rendering ──────────────────────────────────────────────────

  private render(): void {
    this.renderModelSelector();
    this.renderThinkingSelector();
    this.renderTokenCount();
    this.renderVaultRestriction();
    this.renderPermissionToggle();
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
      });
    }
  }

  private renderThinkingSelector(): void {
    const { thinkingBudget } = this.state;

    const currentInfo = THINKING_BUDGETS.find(b => b.value === thinkingBudget);
    this.thinkingCurrent.textContent = currentInfo?.label ?? 'Off';

    this.thinkingOptions.empty();
    for (const budget of [...THINKING_BUDGETS].reverse()) {
      const gear = this.thinkingOptions.createEl('div', { cls: 'cassandra-thinking-gear' });
      gear.textContent = budget.label;
      gear.setAttribute('title', budget.tokens > 0 ? `${budget.tokens.toLocaleString()} tokens` : 'Disabled');
      if (budget.value === thinkingBudget) gear.addClass('selected');

      gear.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onThinkingChange(budget.value);
      });
    }
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

  private renderVaultRestriction(): void {
    const { vaultRestriction } = this.state;
    this.vaultIcon.toggleClass('active', vaultRestriction);
    this.vaultIcon.setAttribute('title',
      vaultRestriction ? 'Vault restriction: ON (click to disable)' : 'Vault restriction: OFF (click to enable)',
    );
  }

  private renderPermissionToggle(): void {
    const { permissionMode } = this.state;

    if (permissionMode === 'plan') {
      this.toggleSwitch.style.display = 'none';
      this.permissionLabel.textContent = 'PLAN';
      this.permissionLabel.addClass('plan-active');
    } else {
      this.toggleSwitch.style.display = '';
      this.permissionLabel.removeClass('plan-active');
      if (permissionMode === 'bypassPermissions') {
        this.toggleSwitch.addClass('active');
        this.permissionLabel.textContent = 'YOLO';
      } else {
        this.toggleSwitch.removeClass('active');
        this.permissionLabel.textContent = 'Safe';
      }
    }
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1000) {
      const k = tokens / 1000;
      return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
    }
    return String(tokens);
  }
}
