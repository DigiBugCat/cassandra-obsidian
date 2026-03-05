/**
 * SubagentRenderer — renders nested agent activity for Task tool calls.
 *
 * Creates a collapsible block for each subagent (parentToolUseId), routes
 * inner events (text, tool_use, tool_result) to render inside the block.
 */

import { setIcon } from 'obsidian';

import type { AgentEvent } from '../../../core/types';
import { renderToolCall, updateToolCallResult } from './ToolCallRenderer';

export interface SubagentBlock {
  wrapperEl: HTMLElement;
  headerEl: HTMLElement;
  contentEl: HTMLElement;
  statusEl: HTMLElement;
  textEl: HTMLElement | null;
  textContent: string;
  toolCallElements: Map<string, HTMLElement>;
  collapsed: boolean;
}

const subagentBlocks = new Map<string, SubagentBlock>();

export function getOrCreateSubagentBlock(
  parentToolUseId: string,
  parentEl: HTMLElement,
  description?: string,
): SubagentBlock {
  const existing = subagentBlocks.get(parentToolUseId);
  if (existing) return existing;

  const wrapper = parentEl.createEl('div', { cls: 'cassandra-subagent-block' });

  const header = wrapper.createEl('div', { cls: 'cassandra-subagent-header' });
  const iconEl = header.createEl('span', { cls: 'cassandra-subagent-icon' });
  setIcon(iconEl, 'git-branch');
  header.createEl('span', {
    cls: 'cassandra-subagent-label',
    text: description || 'Subagent',
  });
  const statusEl = header.createEl('span', { cls: 'cassandra-subagent-status' });
  setIcon(statusEl, 'loader');

  const content = wrapper.createEl('div', { cls: 'cassandra-subagent-content' });
  content.style.display = 'none'; // collapsed by default

  header.addEventListener('click', () => {
    const block = subagentBlocks.get(parentToolUseId);
    if (!block) return;
    block.collapsed = !block.collapsed;
    content.style.display = block.collapsed ? 'none' : '';
    wrapper.toggleClass('is-expanded', !block.collapsed);
  });

  const block: SubagentBlock = {
    wrapperEl: wrapper,
    headerEl: header,
    contentEl: content,
    statusEl,
    textEl: null,
    textContent: '',
    toolCallElements: new Map(),
    collapsed: true,
  };
  subagentBlocks.set(parentToolUseId, block);
  return block;
}

export function handleSubagentEvent(
  parentToolUseId: string,
  event: AgentEvent,
  parentEl: HTMLElement,
): void {
  const block = getOrCreateSubagentBlock(parentToolUseId, parentEl);

  switch (event.type) {
    case 'text': {
      if (!block.textEl) {
        block.textEl = block.contentEl.createEl('div', { cls: 'cassandra-subagent-text' });
      }
      block.textContent += event.content;
      block.textEl.textContent = block.textContent;
      break;
    }

    case 'tool_use': {
      // Finalize any current text
      block.textEl = null;
      block.textContent = '';

      const toolCall = {
        id: event.id,
        name: event.name,
        input: event.input,
        status: 'running' as const,
        isExpanded: false,
      };
      renderToolCall(block.contentEl, toolCall, block.toolCallElements);
      break;
    }

    case 'tool_result': {
      const toolEl = block.toolCallElements.get(event.id);
      if (toolEl) {
        const toolCall = {
          id: event.id,
          name: '',
          input: {},
          status: event.isError ? 'error' as const : 'completed' as const,
          result: event.content,
          isExpanded: false,
        };
        updateToolCallResult(event.id, toolCall, block.toolCallElements);
      }
      break;
    }

    case 'done':
    case 'error':
      finalizeSubagentBlock(parentToolUseId, event.type === 'error');
      break;
  }
}

export function finalizeSubagentBlock(parentToolUseId: string, isError = false): void {
  const block = subagentBlocks.get(parentToolUseId);
  if (!block) return;

  block.statusEl.empty();
  setIcon(block.statusEl, isError ? 'x-circle' : 'check-circle');
  block.statusEl.toggleClass('status-completed', !isError);
  block.statusEl.toggleClass('status-error', isError);
}

export function clearSubagentBlocks(): void {
  subagentBlocks.clear();
}
