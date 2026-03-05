/**
 * ApprovalModal — shows a permission prompt for tool execution.
 *
 * Displays tool name, input summary, and Allow/Deny buttons.
 * Returns a promise that resolves with the user's decision.
 */

import type { App } from 'obsidian';
import { Modal, setIcon } from 'obsidian';

import type { ApprovalDecision } from '../core/types';

export class ApprovalModal extends Modal {
  private toolName: string;
  private input: Record<string, unknown>;
  private summary: string;
  private resolve: ((decision: ApprovalDecision) => void) | null = null;

  constructor(app: App, toolName: string, input: Record<string, unknown>, summary: string) {
    super(app);
    this.toolName = toolName;
    this.input = input;
    this.summary = summary;
  }

  static prompt(app: App, toolName: string, input: Record<string, unknown>, summary: string): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      const modal = new ApprovalModal(app, toolName, input, summary);
      modal.resolve = resolve;
      modal.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('cassandra-approval-modal');

    // Header
    const header = contentEl.createEl('div', { cls: 'cassandra-approval-header' });
    const icon = header.createEl('span', { cls: 'cassandra-approval-icon' });
    setIcon(icon, 'shield-question');
    header.createEl('span', { cls: 'cassandra-approval-title', text: 'Permission Request' });

    // Tool name
    contentEl.createEl('div', { cls: 'cassandra-approval-tool', text: this.toolName });

    // Summary
    contentEl.createEl('div', { cls: 'cassandra-approval-summary', text: this.summary });

    // Input details (collapsed)
    if (Object.keys(this.input).length > 0) {
      const detailsEl = contentEl.createEl('details', { cls: 'cassandra-approval-details' });
      detailsEl.createEl('summary', { text: 'View input' });
      const pre = detailsEl.createEl('pre', { cls: 'cassandra-approval-input-pre' });
      pre.textContent = JSON.stringify(this.input, null, 2);
    }

    // Buttons
    const buttons = contentEl.createEl('div', { cls: 'cassandra-approval-buttons' });

    const denyBtn = buttons.createEl('button', { cls: 'cassandra-approval-btn cassandra-approval-deny', text: 'Deny' });
    denyBtn.addEventListener('click', () => {
      this.resolve?.('deny');
      this.close();
    });

    const allowBtn = buttons.createEl('button', { cls: 'cassandra-approval-btn cassandra-approval-allow', text: 'Allow' });
    allowBtn.addEventListener('click', () => {
      this.resolve?.('allow');
      this.close();
    });

    const alwaysBtn = buttons.createEl('button', { cls: 'cassandra-approval-btn cassandra-approval-always', text: 'Always Allow' });
    alwaysBtn.addEventListener('click', () => {
      this.resolve?.('allow-always');
      this.close();
    });

    // Focus allow button
    allowBtn.focus();
  }

  onClose(): void {
    // If closed without a decision (e.g. Escape), deny
    this.resolve?.('deny');
    this.resolve = null;
    this.contentEl.empty();
  }
}
