import { setIcon } from 'obsidian';

import { getToolIcon, MCP_ICON_MARKER } from '../../../core/tools/toolIcons';
import { extractResolvedAnswersFromResultText } from '../../../core/tools/toolInput';
import {
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_LS,
  TOOL_READ,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';
import type { ToolCallInfo } from '../../../core/types';
import { MCP_ICON_SVG } from '../../../shared/icons';
import { setupCollapsible } from './collapsible';

function isMcpToolName(name: string): boolean {
  return name.startsWith('mcp__');
}

function parseMcpToolName(name: string): string {
  const stripped = name.slice(5);
  const parts = stripped.split('__');
  if (parts.length >= 2) {
    return `${parts[0]}: ${parts.slice(1).join('.')}`;
  }
  return stripped || name;
}

export function setToolIcon(el: HTMLElement, name: string): void {
  const icon = getToolIcon(name);
  if (icon === MCP_ICON_MARKER) {
    el.innerHTML = MCP_ICON_SVG;
  } else {
    setIcon(el, icon);
  }
}

export function getToolName(name: string, _input: Record<string, unknown>): string {
  return name;
}

export function getToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case TOOL_READ:
    case TOOL_WRITE:
    case TOOL_EDIT: {
      const filePath = (input.file_path as string) || '';
      return fileNameOnly(filePath);
    }
    case TOOL_BASH: {
      const cmd = (input.command as string) || '';
      return truncateText(cmd, 60);
    }
    case TOOL_GLOB:
    case TOOL_GREP:
      return (input.pattern as string) || '';
    case TOOL_WEB_SEARCH:
      return truncateText((input.query as string) || '', 60);
    case TOOL_WEB_FETCH:
      return truncateText((input.url as string) || '', 60);
    case TOOL_LS:
      return fileNameOnly((input.path as string) || '.');
    default:
      return '';
  }
}

/** Combined name+summary for ARIA labels (collapsible regions need a single descriptive phrase). */
export function getToolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case TOOL_READ:
      return `Read: ${shortenPath(input.file_path as string) || 'file'}`;
    case TOOL_WRITE:
      return `Write: ${shortenPath(input.file_path as string) || 'file'}`;
    case TOOL_EDIT:
      return `Edit: ${shortenPath(input.file_path as string) || 'file'}`;
    case TOOL_BASH: {
      const cmd = (input.command as string) || 'command';
      return `Bash: ${cmd.length > 40 ? cmd.substring(0, 40) + '...' : cmd}`;
    }
    case TOOL_GLOB:
      return `Glob: ${input.pattern || 'files'}`;
    case TOOL_GREP:
      return `Grep: ${input.pattern || 'pattern'}`;
    case TOOL_WEB_SEARCH: {
      const query = (input.query as string) || 'search';
      return `WebSearch: ${query.length > 40 ? query.substring(0, 40) + '...' : query}`;
    }
    case TOOL_WEB_FETCH: {
      const url = (input.url as string) || 'url';
      return `WebFetch: ${url.length > 40 ? url.substring(0, 40) + '...' : url}`;
    }
    case TOOL_LS:
      return `LS: ${shortenPath(input.path as string) || '.'}`;
    default:
      return isMcpToolName(name) ? parseMcpToolName(name) : name;
  }
}

export function fileNameOnly(filePath: string): string {
  if (!filePath) return '';
  return filePath.split('/').pop() || filePath;
}

/** Get the absolute file path from a tool call's input, if applicable. */
export function getToolFilePath(name: string, input: Record<string, unknown>): string | null {
  switch (name) {
    case TOOL_READ:
    case TOOL_WRITE:
    case TOOL_EDIT:
      return (input.file_path as string) || null;
    case TOOL_LS:
      return (input.path as string) || null;
    default:
      return null;
  }
}

/** Make an element a clickable file link (handled by delegated registerFileLinkHandler). */
export function applyFileLink(el: HTMLElement, filePath: string): void {
  el.addClass('cassandra-file-link');
  el.setAttribute('data-href', filePath);
}

function shortenPath(filePath: string | undefined): string {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.length <= 3) return normalized;
  return '.../' + parts.slice(-2).join('/');
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

interface WebSearchLink {
  title: string;
  url: string;
}

function parseWebSearchResult(result: string): { links: WebSearchLink[]; summary: string } | null {
  const linksMatch = result.match(/Links:\s*(\[[\s\S]*?\])(?:\n|$)/);
  if (!linksMatch) return null;

  try {
    const parsed = JSON.parse(linksMatch[1]) as WebSearchLink[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const linksEndIndex = result.indexOf(linksMatch[0]) + linksMatch[0].length;
    const summary = result.slice(linksEndIndex).trim();
    return { links: parsed.filter(l => l.title && l.url), summary };
  } catch {
    return null;
  }
}

function renderWebSearchExpanded(container: HTMLElement, result: string): void {
  const parsed = parseWebSearchResult(result);
  if (!parsed || parsed.links.length === 0) {
    renderLinesExpanded(container, result, 20);
    return;
  }

  const linksEl = container.createDiv({ cls: 'cassandra-tool-lines' });
  for (const link of parsed.links) {
    const linkEl = linksEl.createEl('a', { cls: 'cassandra-tool-link' });
    linkEl.setAttribute('href', link.url);
    linkEl.setAttribute('target', '_blank');
    linkEl.setAttribute('rel', 'noopener noreferrer');

    const iconEl = linkEl.createSpan({ cls: 'cassandra-tool-link-icon' });
    setIcon(iconEl, 'external-link');

    linkEl.createSpan({ cls: 'cassandra-tool-link-title', text: link.title });
  }

  if (parsed.summary) {
    const summaryEl = container.createDiv({ cls: 'cassandra-tool-web-summary' });
    summaryEl.setText(parsed.summary.length > 800 ? parsed.summary.slice(0, 800) + '...' : parsed.summary);
  }
}

function renderFileSearchExpanded(container: HTMLElement, result: string): void {
  const lines = result.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) {
    container.createDiv({ cls: 'cassandra-tool-empty', text: 'No matches found' });
    return;
  }
  renderLinesExpanded(container, result, 15, true);
}

function renderLinesExpanded(
  container: HTMLElement,
  result: string,
  maxLines: number,
  hoverable = false
): void {
  const lines = result.split(/\r?\n/);
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;

  const linesEl = container.createDiv({ cls: 'cassandra-tool-lines' });
  for (const line of displayLines) {
    const stripped = line.replace(/^\s*\d+→/, '');
    const lineEl = linesEl.createDiv({ cls: 'cassandra-tool-line' });
    if (hoverable) lineEl.addClass('hoverable');
    lineEl.setText(stripped || ' ');
  }

  if (truncated) {
    linesEl.createDiv({
      cls: 'cassandra-tool-truncated',
      text: `... ${lines.length - maxLines} more lines`,
    });
  }
}

function renderWebFetchExpanded(container: HTMLElement, result: string): void {
  const maxChars = 500;
  const linesEl = container.createDiv({ cls: 'cassandra-tool-lines' });
  const lineEl = linesEl.createDiv({ cls: 'cassandra-tool-line' });
  lineEl.style.whiteSpace = 'pre-wrap';
  lineEl.style.wordBreak = 'break-word';

  if (result.length > maxChars) {
    lineEl.setText(result.slice(0, maxChars));
    linesEl.createDiv({
      cls: 'cassandra-tool-truncated',
      text: `... ${result.length - maxChars} more characters`,
    });
  } else {
    lineEl.setText(result);
  }
}

export function renderExpandedContent(
  container: HTMLElement,
  toolName: string,
  result: string | undefined,
  input?: Record<string, unknown>
): void {
  // Show full command input for Bash tool calls (header only shows truncated version)
  if (toolName === TOOL_BASH && input?.command) {
    const cmdEl = container.createDiv({ cls: 'cassandra-tool-command' });
    cmdEl.setText(input.command as string);
  }

  if (!result) {
    container.createDiv({ cls: 'cassandra-tool-empty', text: 'No result' });
    return;
  }

  switch (toolName) {
    case TOOL_BASH:
      renderLinesExpanded(container, result, 20);
      break;
    case TOOL_READ:
      renderLinesExpanded(container, result, 15);
      break;
    case TOOL_GLOB:
    case TOOL_GREP:
    case TOOL_LS:
      renderFileSearchExpanded(container, result);
      break;
    case TOOL_WEB_SEARCH:
      renderWebSearchExpanded(container, result);
      break;
    case TOOL_WEB_FETCH:
      renderWebFetchExpanded(container, result);
      break;
    default:
      renderLinesExpanded(container, result, 20);
      break;
  }
}

export function isBlockedToolResult(content: string | undefined, isError?: boolean): boolean {
  if (!content) return false;
  const lower = content.toLowerCase();
  if (lower.includes('outside the vault')) return true;
  if (lower.includes('access denied')) return true;
  if (lower.includes('user denied')) return true;
  if (lower.includes('approval')) return true;
  if (isError && lower.includes('deny')) return true;
  return false;
}

interface ToolElementStructure {
  toolEl: HTMLElement;
  header: HTMLElement;
  iconEl: HTMLElement;
  nameEl: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
  content: HTMLElement;
  currentTaskEl: HTMLElement | null;
}

function createToolElementStructure(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo
): ToolElementStructure {
  const toolEl = parentEl.createDiv({ cls: 'cassandra-tool-call' });

  const header = toolEl.createDiv({ cls: 'cassandra-tool-header' });
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');

  const iconEl = header.createSpan({ cls: 'cassandra-tool-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  setToolIcon(iconEl, toolCall.name);

  const nameEl = header.createSpan({ cls: 'cassandra-tool-name' });
  nameEl.setText(getToolName(toolCall.name, toolCall.input));

  const summaryEl = header.createSpan({ cls: 'cassandra-tool-summary' });
  summaryEl.setText(getToolSummary(toolCall.name, toolCall.input));
  const filePath = getToolFilePath(toolCall.name, toolCall.input);
  if (filePath) {
    applyFileLink(summaryEl, filePath);
  }

  const statusEl = header.createSpan({ cls: 'cassandra-tool-status' });

  const content = toolEl.createDiv({ cls: 'cassandra-tool-content' });

  return { toolEl, header, iconEl, nameEl, summaryEl, statusEl, content, currentTaskEl: null };
}

function formatAnswer(raw: unknown): string {
  if (Array.isArray(raw)) return raw.join(', ');
  if (typeof raw === 'string') return raw;
  return '';
}

function resolveAskUserAnswers(toolCall: ToolCallInfo): Record<string, unknown> | undefined {
  if (toolCall.resolvedAnswers) return toolCall.resolvedAnswers as Record<string, unknown>;

  const parsed = extractResolvedAnswersFromResultText(toolCall.result);
  if (parsed) {
    toolCall.resolvedAnswers = parsed;
    return parsed;
  }

  return undefined;
}

function renderAskUserQuestionResult(container: HTMLElement, toolCall: ToolCallInfo): boolean {
  container.empty();
  const questions = toolCall.input.questions as Array<{ question: string }> | undefined;
  const answers = resolveAskUserAnswers(toolCall);
  if (!questions || !Array.isArray(questions) || !answers) return false;

  const reviewEl = container.createDiv({ cls: 'cassandra-ask-review' });
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const answer = formatAnswer(answers[q.question]);
    const pairEl = reviewEl.createDiv({ cls: 'cassandra-ask-review-pair' });
    pairEl.createDiv({ text: `${i + 1}.`, cls: 'cassandra-ask-review-num' });
    const bodyEl = pairEl.createDiv({ cls: 'cassandra-ask-review-body' });
    bodyEl.createDiv({ text: q.question, cls: 'cassandra-ask-review-q-text' });
    bodyEl.createDiv({
      text: answer || 'Not answered',
      cls: answer ? 'cassandra-ask-review-a-text' : 'cassandra-ask-review-empty',
    });
  }

  return true;
}

function renderAskUserQuestionFallback(container: HTMLElement, toolCall: ToolCallInfo, initialText?: string): void {
  contentFallback(container, initialText || toolCall.result || 'Waiting for answer...');
}

function contentFallback(container: HTMLElement, text: string): void {
  const resultRow = container.createDiv({ cls: 'cassandra-tool-result-row' });
  const resultText = resultRow.createSpan({ cls: 'cassandra-tool-result-text' });
  resultText.setText(text);
}

function resetStatusElement(statusEl: HTMLElement, statusClass: string, ariaLabel: string): void {
  statusEl.className = 'cassandra-tool-status';
  statusEl.empty();
  statusEl.addClass(statusClass);
  statusEl.setAttribute('aria-label', ariaLabel);
}

const STATUS_ICONS: Record<string, string> = {
  queued: 'clock',
  completed: 'check',
  error: 'x',
  blocked: 'shield-off',
};

function setToolStatus(statusEl: HTMLElement, status: ToolCallInfo['status']): void {
  resetStatusElement(statusEl, `status-${status}`, `Status: ${status}`);
  const icon = STATUS_ICONS[status];
  if (icon) setIcon(statusEl, icon);
}

function renderMcpSection(
  parent: HTMLElement,
  label: string,
  content: string,
): void {
  const section = parent.createDiv({ cls: 'cassandra-mcp-section' });
  section.createDiv({ cls: 'cassandra-mcp-section-label', text: label });
  const body = section.createDiv({ cls: 'cassandra-mcp-section-body' });
  body.setText(content);
}

function renderMcpToolContent(
  content: HTMLElement,
  toolCall: ToolCallInfo,
  initialText?: string,
): void {
  content.empty();
  content.addClass('cassandra-tool-content-mcp');

  type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | { [key: string]: JsonValue };

  const safeJsonStringify = (value: unknown): string => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      // Should be rare; ToolCallInfo.input is expected to be JSON-serializable.
      return String(value);
    }
  };

  const tryParseJson = (text: string): JsonValue | null => {
    const trimmed = text.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.parse(trimmed) as JsonValue;
      } catch {
        // Not valid JSON; fall through
      }
    }
    return null;
  };

  const isObject = (v: JsonValue): v is { [key: string]: JsonValue } =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

  // Many MCP implementations return JSON-RPC-ish wrappers or "content"/"text" wrappers.
  // If we can sensibly extract a human-readable payload, show it first (while preserving raw).
  const extractUsefulText = (v: JsonValue): string | null => {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean' || v === null) return null;

    if (Array.isArray(v)) {
      const parts = v
        .map(item => extractUsefulText(item))
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
      return parts.length ? parts.join('\n') : null;
    }

    if (!isObject(v)) return null;

    // JSON-RPC common shapes
    if (v.error && isObject(v.error)) {
      const msg = v.error.message;
      if (typeof msg === 'string' && msg.trim()) return msg;
    }
    if (v.result !== undefined) {
      const inner = extractUsefulText(v.result);
      if (inner) return inner;
    }

    // Common wrapper keys
    const directKeys = ['output', 'content', 'text', 'message', 'data'] as const;
    for (const k of directKeys) {
      const inner = v[k];
      if (typeof inner === 'string' && inner.trim()) return inner;
      if (Array.isArray(inner)) {
        // e.g. content: [{type:"text", text:"..."}, ...]
        const arrParts = inner
          .map(item => extractUsefulText(item))
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
        if (arrParts.length) return arrParts.join('\n');
      }
      if (inner && typeof inner === 'object') {
        const nested = extractUsefulText(inner);
        if (nested) return nested;
      }
    }

    // stdout/stderr wrapper
    const stdout = v.stdout;
    const stderr = v.stderr;
    if (typeof stdout === 'string' || typeof stderr === 'string') {
      const lines: string[] = [];
      if (typeof stdout === 'string' && stdout.trim()) lines.push(stdout);
      if (typeof stderr === 'string' && stderr.trim()) lines.push(stderr);
      return lines.length ? lines.join('\n') : null;
    }

    return null;
  };

  // Request section - always show the input JSON
  renderMcpSection(content, 'Request', safeJsonStringify(toolCall.input));

  // Response section - show streaming text if provided, otherwise result or status fallback
  let responseText = initialText || toolCall.result;
  if (!responseText) {
    if (toolCall.status === 'queued') {
      responseText = 'Waiting for response...';
    } else if (toolCall.status === 'running') {
      responseText = 'Running...';
    } else {
      responseText = 'No result';
    }
  }

  // Don't try to parse/pretty-print while streaming; we usually only have placeholders.
  if (initialText) {
    renderMcpSection(content, 'Response', responseText);
    return;
  }

  const parsed = tryParseJson(responseText);
  if (!parsed) {
    renderMcpSection(content, 'Response', responseText);
    return;
  }

  const prettyRaw = safeJsonStringify(parsed);
  const extracted = extractUsefulText(parsed);
  if (extracted && extracted.trim() && extracted.trim() !== prettyRaw.trim()) {
    renderMcpSection(content, 'Response', `Extracted:\n${extracted}\n\nRaw:\n${prettyRaw}`);
    return;
  }

  renderMcpSection(content, 'Response', prettyRaw);
}

function renderToolContent(
  content: HTMLElement,
  toolCall: ToolCallInfo,
  initialText?: string
): void {
  if (toolCall.name === TOOL_ASK_USER_QUESTION) {
    content.addClass('cassandra-tool-content-ask');
    if (initialText) {
      renderAskUserQuestionFallback(content, toolCall, 'Waiting for answer...');
    } else if (!renderAskUserQuestionResult(content, toolCall)) {
      renderAskUserQuestionFallback(content, toolCall);
    }
  } else if (isMcpToolName(toolCall.name)) {
    renderMcpToolContent(content, toolCall, initialText);
  } else if (initialText) {
    contentFallback(content, initialText);
  } else {
    renderExpandedContent(content, toolCall.name, toolCall.result, toolCall.input);
  }
}

export function renderToolCall(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo,
  toolCallElements: Map<string, HTMLElement>
): HTMLElement {
  const { toolEl, header, statusEl, content } =
    createToolElementStructure(parentEl, toolCall);

  toolEl.dataset.toolId = toolCall.id;
  toolCallElements.set(toolCall.id, toolEl);

  setToolStatus(statusEl, toolCall.status);
  const initialText = toolCall.status === 'queued'
    ? 'Waiting for response...'
    : (toolCall.status === 'running' ? 'Running...' : undefined);
  renderToolContent(content, toolCall, initialText);

  const state = { isExpanded: false };
  toolCall.isExpanded = false;
  setupCollapsible(toolEl, header, content, state, {
    initiallyExpanded: false,
    onToggle: (expanded) => {
      toolCall.isExpanded = expanded;
    },
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input)
  });

  return toolEl;
}

export function updateMcpToolInput(
  toolId: string,
  toolCall: ToolCallInfo,
  toolCallElements: Map<string, HTMLElement>
): void {
  if (!isMcpToolName(toolCall.name)) return;
  const toolEl = toolCallElements.get(toolId);
  if (!toolEl) return;
  const content = toolEl.querySelector('.cassandra-tool-content') as HTMLElement;
  if (content) {
    renderMcpToolContent(content, toolCall);
  }
}

export function updateToolCallResult(
  toolId: string,
  toolCall: ToolCallInfo,
  toolCallElements: Map<string, HTMLElement>
) {
  const toolEl = toolCallElements.get(toolId);
  if (!toolEl) return;

  const statusEl = toolEl.querySelector('.cassandra-tool-status') as HTMLElement;
  if (statusEl) {
    setToolStatus(statusEl, toolCall.status);
  }

  if (toolCall.name === TOOL_ASK_USER_QUESTION) {
    const content = toolEl.querySelector('.cassandra-tool-content') as HTMLElement;
    if (content) {
      content.addClass('cassandra-tool-content-ask');
      if (!renderAskUserQuestionResult(content, toolCall)) {
        renderAskUserQuestionFallback(content, toolCall);
      }
    }
    return;
  }

  if (isMcpToolName(toolCall.name)) {
    const content = toolEl.querySelector('.cassandra-tool-content') as HTMLElement;
    if (content) {
      renderMcpToolContent(content, toolCall);
    }
    return;
  }

  const content = toolEl.querySelector('.cassandra-tool-content') as HTMLElement;
  if (content) {
    content.empty();
    renderExpandedContent(content, toolCall.name, toolCall.result, toolCall.input);
  }
}

/** For stored (non-streaming) tool calls — collapsed by default. */
export function renderStoredToolCall(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo
): HTMLElement {
  const { toolEl, header, statusEl, content } =
    createToolElementStructure(parentEl, toolCall);

  setToolStatus(statusEl, toolCall.status);

  renderToolContent(content, toolCall);

  const state = { isExpanded: false };
  setupCollapsible(toolEl, header, content, state, {
    initiallyExpanded: false,
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input)
  });

  return toolEl;
}
