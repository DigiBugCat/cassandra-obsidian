import { createLogger } from '../../../core/logging';
import type {
  CassandraSettings,
  ChatMessage,
  DiffLine,
  DiffStats,
  StreamEvent,
  ToolCallInfo,
  ToolDiffData,
} from '../../../core/types';
import {
  appendThinkingContent,
  clearSubagentBlocks,
  createThinkingBlock,
  createWriteEditBlock,
  finalizeThinkingBlock,
  finalizeWriteEditBlock,
  getToolName,
  getToolSummary,
  handleSubagentEvent,
  isBlockedToolResult,
  renderToolCall,
  updateMcpToolInput,
  updateToolCallResult,
  updateWriteEditWithDiff,
} from '../rendering';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import type { ChatState } from '../state';

// ── Flavor texts displayed while waiting for a model response ──

const FLAVOR_TEXTS = [
  'Thinking...',
  'Working on it...',
  'Processing...',
  'Analyzing...',
  'Considering...',
  'Reasoning...',
  'Exploring...',
  'Evaluating...',
];

// ── Small pure helpers ──

function isWriteEditTool(name: string): boolean {
  return name === 'Write' || name === 'Edit';
}

function isMcpTool(name: string): boolean {
  return name.startsWith('mcp__');
}

function formatDurationMmSs(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// ── Dependency contract ──

export interface StreamControllerDeps {
  state: ChatState;
  renderer: MessageRenderer;
  getMessagesEl: () => HTMLElement;
  getSettings: () => CassandraSettings;
  onSessionStale?: (retryPrompt?: string) => Promise<boolean>;
}

// ── StreamController ──────────────────────────────────────────────────

export class StreamController {
  private deps: StreamControllerDeps;
  private readonly logger = createLogger('StreamController');

  /** Debounce before the thinking indicator appears (ms). */
  private static readonly THINKING_INDICATOR_DELAY = 400;

  /** Drip buffer: fixed tick rate, adaptive chunk size. */
  private static readonly DRIP_INTERVAL_MS = 20;
  private static readonly DRIP_MIN_CHARS = 1;
  private static readonly DRIP_MAX_CHARS = 12;
  private static readonly DRIP_RAMP_THRESHOLD = 120;

  constructor(deps: StreamControllerDeps) {
    this.deps = deps;
  }

  // ============================================
  // Stream Event Dispatch
  // ============================================

  async handleStreamEvent(chunk: StreamEvent, msg: ChatMessage): Promise<void> {
    const { state } = this.deps;

    this.logger.debug('handle stream event', {
      type: chunk.type,
      messageId: msg.id,
      pendingTools: state.pendingTools.size,
    });

    // Subagent events — route to SubagentRenderer
    if (chunk.type === 'subagent_event') {
      if (state.currentContentEl) {
        handleSubagentEvent(chunk.parentToolUseId, chunk.event, state.currentContentEl);
      }
      this.scrollToBottom();
      return;
    }

    switch (chunk.type) {
      case 'text': {
        this.flushPendingTools();
        if (state.currentThinkingState) this.finalizeCurrentThinkingBlock(msg);
        msg.content += chunk.content;
        this.appendText(chunk.content);
        break;
      }

      case 'thinking': {
        this.flushPendingTools();
        if (state.currentTextEl) this.finalizeCurrentTextBlock(msg);
        await this.appendThinking(chunk.content);
        break;
      }

      case 'tool_use': {
        if (state.currentThinkingState) this.finalizeCurrentThinkingBlock(msg);
        this.finalizeCurrentTextBlock(msg);
        this.handleRegularToolUse(chunk, msg);
        break;
      }

      case 'tool_input_update': {
        const existing = msg.toolCalls?.find(tc => tc.id === chunk.id);
        if (existing) {
          existing.input = { ...existing.input, ...chunk.input };
          const toolEl = state.toolCallElements.get(chunk.id);
          if (toolEl) {
            const nameEl =
              (toolEl.querySelector('.cassandra-tool-name') as HTMLElement | null) ??
              (toolEl.querySelector('.cassandra-write-edit-name') as HTMLElement | null);
            if (nameEl) nameEl.setText(getToolName(existing.name, existing.input));
            const summaryEl =
              (toolEl.querySelector('.cassandra-tool-summary') as HTMLElement | null) ??
              (toolEl.querySelector('.cassandra-write-edit-summary') as HTMLElement | null);
            if (summaryEl) summaryEl.setText(getToolSummary(existing.name, existing.input));
            if (isMcpTool(existing.name)) {
              updateMcpToolInput(chunk.id, existing, state.toolCallElements);
            }
          }
        }
        break;
      }

      case 'tool_result': {
        this.logger.debug('tool_result', { id: chunk.id, isError: chunk.isError === true });
        this.handleToolResult(chunk, msg);
        break;
      }

      case 'usage': {
        state.usage = chunk.usage;
        break;
      }

      case 'done': {
        this.flushPendingTools();
        if (state.currentThinkingState) this.finalizeCurrentThinkingBlock(msg);
        this.finalizeCurrentTextBlock(msg);
        break;
      }

      case 'error': {
        this.flushPendingTools();
        const isStale = /session (has )?stop/i.test(chunk.content) || /session not found/i.test(chunk.content);
        if (isStale && this.deps.onSessionStale) {
          this.appendText('\n\nSession expired — reconnecting...');
          // Grab the user's prompt from the preceding message for retry
          const userMsg = state.messages.filter(m => m.role === 'user').pop();
          this.deps.onSessionStale(userMsg?.content);
        } else {
          this.appendText(`\n\n**Error:** ${chunk.content}`);
        }
        break;
      }

      case 'blocked': {
        this.flushPendingTools();
        this.appendText(`\n\n**Blocked:** ${chunk.content}`);
        break;
      }

      case 'compact_boundary': {
        this.flushPendingTools();
        if (state.currentThinkingState) this.finalizeCurrentThinkingBlock(msg);
        this.finalizeCurrentTextBlock(msg);
        msg.contentBlocks = msg.contentBlocks ?? [];
        msg.contentBlocks.push({ type: 'compact_boundary' });
        this.renderCompactBoundary();
        break;
      }

      // SDK session UUID events — store on messages for rewind/fork.
      case 'sdk_user_uuid':
        msg.sdkUserUuid = chunk.uuid;
        break;
      case 'sdk_assistant_uuid':
        msg.sdkAssistantUuid = chunk.uuid;
        break;
      case 'sdk_user_sent':
        break;

      // Hook events — deferred to a later phase.
      case 'hook_started':
      case 'hook_progress':
      case 'hook_response':
        this.logger.debug('hook event — skipping (Phase 3)', { type: chunk.type });
        break;
    }

    this.scrollToBottom();
  }

  // ============================================
  // Tool Use Handling
  // ============================================

  /**
   * Buffers non-MCP tool_use events; renders MCP tools immediately so users
   * see them in flight. The buffer is flushed when a different content type
   * (text, thinking) arrives or the stream ends.
   */
  private handleRegularToolUse(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage
  ): void {
    const { state } = this.deps;
    const mcpTool = isMcpTool(chunk.name);

    // Streaming input merge — update an already-registered tool call.
    const existing = msg.toolCalls?.find(tc => tc.id === chunk.id);
    if (existing) {
      const newInput = chunk.input ?? {};
      if (Object.keys(newInput).length > 0) {
        existing.input = { ...existing.input, ...newInput };
        const toolEl = state.toolCallElements.get(chunk.id);
        if (toolEl) {
          const nameEl =
            (toolEl.querySelector('.cassandra-tool-name') as HTMLElement | null) ??
            (toolEl.querySelector('.cassandra-write-edit-name') as HTMLElement | null);
          if (nameEl) nameEl.setText(getToolName(existing.name, existing.input));
          const summaryEl =
            (toolEl.querySelector('.cassandra-tool-summary') as HTMLElement | null) ??
            (toolEl.querySelector('.cassandra-write-edit-summary') as HTMLElement | null);
          if (summaryEl) summaryEl.setText(getToolSummary(existing.name, existing.input));
          if (mcpTool) updateMcpToolInput(chunk.id, existing, state.toolCallElements);
        }
      }
      return;
    }

    // First occurrence — register and buffer (or render immediately for MCP).
    const toolCall: ToolCallInfo = {
      id: chunk.id,
      name: chunk.name,
      input: chunk.input,
      status: mcpTool ? 'queued' : 'running',
      isExpanded: false,
    };

    msg.toolCalls = msg.toolCalls ?? [];
    msg.toolCalls.push(toolCall);
    state.activeToolCallCount++;

    msg.contentBlocks = msg.contentBlocks ?? [];
    msg.contentBlocks.push({ type: 'tool_use', toolId: chunk.id });

    if (state.currentContentEl) {
      if (mcpTool) {
        renderToolCall(state.currentContentEl, toolCall, state.toolCallElements);
      } else {
        state.pendingTools.set(chunk.id, { toolCall, parentEl: state.currentContentEl });
      }
      this.showThinkingIndicator();
    }
  }

  /** Renders all buffered tool calls in insertion order, then clears the buffer. */
  private flushPendingTools(): void {
    const { state } = this.deps;
    if (state.pendingTools.size === 0) return;
    for (const toolId of state.pendingTools.keys()) {
      this.renderPendingTool(toolId);
    }
    state.pendingTools.clear();
  }

  /**
   * Renders one buffered tool call.
   * Write/Edit tools get a diff-capable block; all others use the standard renderer.
   */
  private renderPendingTool(toolId: string): void {
    const { state } = this.deps;
    const pending = state.pendingTools.get(toolId);
    if (!pending) return;
    const { toolCall, parentEl } = pending;
    if (!parentEl) return;

    if (isWriteEditTool(toolCall.name)) {
      const weState = createWriteEditBlock(parentEl, toolCall);
      state.writeEditStates.set(toolId, weState);
      state.toolCallElements.set(toolId, weState.wrapperEl);
    } else {
      renderToolCall(parentEl, toolCall, state.toolCallElements);
    }

    state.pendingTools.delete(toolId);
  }

  private handleToolResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; meta?: unknown },
    msg: ChatMessage
  ): void {
    const { state } = this.deps;

    // Flush the specific tool before applying its result.
    if (state.pendingTools.has(chunk.id)) {
      this.renderPendingTool(chunk.id);
    }

    const toolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
    if (toolCall) {
      const isBlocked = isBlockedToolResult(chunk.content, chunk.isError);
      toolCall.status = chunk.isError ? 'error' : isBlocked ? 'blocked' : 'completed';
      toolCall.result = chunk.content;

      const weState = state.writeEditStates.get(chunk.id);
      if (weState && isWriteEditTool(toolCall.name)) {
        if (!chunk.isError && !isBlocked) {
          const diffData = extractDiffDataFromMeta(chunk.meta, toolCall);
          if (diffData) {
            toolCall.diffData = diffData;
            updateWriteEditWithDiff(weState, diffData);
          }
        }
        finalizeWriteEditBlock(weState, !!(chunk.isError || isBlocked));
      } else {
        updateToolCallResult(chunk.id, toolCall, state.toolCallElements);
      }
    }

    if (state.activeToolCallCount > 0) state.activeToolCallCount--;
    this.showThinkingIndicator();
  }

  // ============================================
  // Text Block Management
  // ============================================

  appendText(text: string): void {
    const { state } = this.deps;
    if (!state.currentContentEl) return;

    this.hideThinkingIndicator();

    if (!state.currentTextEl) {
      state.currentTextEl = state.currentContentEl.createDiv({ cls: 'cassandra-text-block' });
      state.currentTextContent = '';
    }

    state.textDripBuffer += text;
    this.logger.debug('appendText: buffered', {
      incomingLen: text.length,
      incomingPreview: text.slice(0, 40),
      bufferLen: state.textDripBuffer.length,
      timerActive: state.textDripTimer !== null,
    });

    if (state.textDripTimer === null) {
      this.scheduleDrip();
    }
  }

  private getDripChunkSize(): number {
    const bufLen = this.deps.state.textDripBuffer.length;
    if (bufLen <= StreamController.DRIP_MIN_CHARS) return bufLen;
    const t = Math.min(bufLen / StreamController.DRIP_RAMP_THRESHOLD, 1);
    return Math.ceil(
      StreamController.DRIP_MIN_CHARS +
        t * (StreamController.DRIP_MAX_CHARS - StreamController.DRIP_MIN_CHARS),
    );
  }

  private scheduleDrip(): void {
    const { state } = this.deps;
    if (state.textDripTimer !== null) return;
    state.textDripTimer = setTimeout(() => {
      state.textDripTimer = null;
      this.dripNext();
    }, StreamController.DRIP_INTERVAL_MS);
  }

  private dripNext(): void {
    const { state, renderer } = this.deps;

    if (!state.textDripBuffer || !state.currentTextEl) return;

    const chunkSize = this.getDripChunkSize();
    const chunk = state.textDripBuffer.slice(0, chunkSize);
    state.textDripBuffer = state.textDripBuffer.slice(chunkSize);

    this.logger.debug('dripNext: rendering', {
      t: Math.round(performance.now()),
      chunkSize,
      chunkPreview: chunk.slice(0, 40),
      remainingBuffer: state.textDripBuffer.length,
      totalContentLen: state.currentTextContent.length + chunk.length,
    });

    state.currentTextContent += chunk;
    void renderer.renderContent(state.currentTextEl, state.currentTextContent);

    this.scrollToBottom();

    // Schedule next drip — the setTimeout enforces minimum delay between renders
    if (state.textDripBuffer.length > 0) {
      this.scheduleDrip();
    }
  }

  finalizeCurrentTextBlock(msg?: ChatMessage): void {
    const { state, renderer } = this.deps;

    // Flush remaining drip buffer
    if (state.textDripTimer !== null) {
      clearTimeout(state.textDripTimer);
      state.textDripTimer = null;
    }
    if (state.textDripBuffer) {
      this.logger.debug('finalizeCurrentTextBlock: flushing buffer', {
        bufferLen: state.textDripBuffer.length,
        bufferPreview: state.textDripBuffer.slice(0, 60),
      });
      state.currentTextContent += state.textDripBuffer;
      state.textDripBuffer = '';
    }

    if (msg && state.currentTextContent) {
      msg.contentBlocks = msg.contentBlocks ?? [];
      msg.contentBlocks.push({ type: 'text', content: state.currentTextContent });
      if (state.currentTextEl) {
        const el = state.currentTextEl;
        const content = state.currentTextContent;
        void renderer.renderContent(el, content).then(() => {
          renderer.addTextCopyButton(el, content);
        });
      }
    }
    state.currentTextEl = null;
    state.currentTextContent = '';
  }

  // ============================================
  // Thinking Block Management
  // ============================================

  async appendThinking(content: string): Promise<void> {
    const { state, renderer } = this.deps;
    if (!state.currentContentEl) return;

    // Skip empty thinking content — avoids "Thought for 0s" when thinking is disabled
    if (!content && !state.currentThinkingState) return;

    this.hideThinkingIndicator();

    if (!state.currentThinkingState) {
      state.currentThinkingState = createThinkingBlock(
        state.currentContentEl,
        (el, md) => renderer.renderContent(el, md)
      );
    }

    await appendThinkingContent(
      state.currentThinkingState,
      content,
      (el, md) => renderer.renderContent(el, md)
    );
  }

  finalizeCurrentThinkingBlock(msg?: ChatMessage): void {
    const { state } = this.deps;
    if (!state.currentThinkingState) return;

    const durationSeconds = finalizeThinkingBlock(state.currentThinkingState);

    if (msg && state.currentThinkingState.content) {
      msg.contentBlocks = msg.contentBlocks ?? [];
      msg.contentBlocks.push({
        type: 'thinking',
        content: state.currentThinkingState.content,
        durationSeconds,
      });
    }

    state.currentThinkingState = null;
  }

  // ============================================
  // Thinking Indicator
  // ============================================

  /**
   * Schedules a flavor text indicator after a debounce delay.
   * The indicator is suppressed if a content event arrives before the timeout fires,
   * keeping the UI clean during rapid streaming turns.
   */
  showThinkingIndicator(overrideText?: string): void {
    const { state } = this.deps;
    if (!state.currentContentEl) return;

    if (state.thinkingIndicatorTimeout) {
      clearTimeout(state.thinkingIndicatorTimeout);
      state.thinkingIndicatorTimeout = null;
    }

    // Suppress while the model's own <thinking> block is active.
    if (state.currentThinkingState) return;

    // Already visible — re-anchor to bottom of content.
    if (state.thinkingEl) {
      state.currentContentEl.appendChild(state.thinkingEl);
      return;
    }

    state.thinkingIndicatorTimeout = setTimeout(() => {
      state.thinkingIndicatorTimeout = null;
      if (!state.currentContentEl || state.thinkingEl || state.currentThinkingState) return;

      state.thinkingEl = state.currentContentEl.createDiv({ cls: 'cassandra-thinking' });

      const text = overrideText ?? FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)];
      state.thinkingEl.createSpan({ text });

      const timerSpan = state.thinkingEl.createSpan({ cls: 'cassandra-thinking-hint' });

      const updateTimer = () => {
        if (!state.responseStartTime) return;
        if (!timerSpan.isConnected) { state.clearFlavorTimerInterval(); return; }
        const elapsed = Math.floor((performance.now() - state.responseStartTime) / 1000);
        timerSpan.setText(` (esc to interrupt · ${formatDurationMmSs(elapsed)})`);
      };

      updateTimer();
      state.clearFlavorTimerInterval();
      state.flavorTimerInterval = setInterval(updateTimer, 1000);
    }, StreamController.THINKING_INDICATOR_DELAY);
  }

  /** Cancels pending show timeout and removes the indicator element from the DOM. */
  hideThinkingIndicator(): void {
    const { state } = this.deps;

    if (state.thinkingIndicatorTimeout) {
      clearTimeout(state.thinkingIndicatorTimeout);
      state.thinkingIndicatorTimeout = null;
    }

    state.clearFlavorTimerInterval();

    if (state.thinkingEl) {
      state.thinkingEl.remove();
      state.thinkingEl = null;
    }
  }

  // ============================================
  // Compact Boundary
  // ============================================

  private renderCompactBoundary(): void {
    const { state } = this.deps;
    if (!state.currentContentEl) return;
    this.hideThinkingIndicator();
    const el = state.currentContentEl.createDiv({ cls: 'cassandra-compact-boundary' });
    el.createSpan({ cls: 'cassandra-compact-boundary-label', text: 'Conversation compacted' });
  }

  // ============================================
  // Reset
  // ============================================

  resetStreamingState(): void {
    const { state } = this.deps;
    this.hideThinkingIndicator();
    if (state.textDripTimer !== null) {
      clearTimeout(state.textDripTimer);
      state.textDripTimer = null;
    }
    state.textDripBuffer = '';
    state.currentContentEl = null;
    state.currentTextEl = null;
    state.currentTextContent = '';
    state.currentThinkingState = null;
    state.activeToolCallCount = 0;
    state.pendingTools.clear();
    clearSubagentBlocks();
  }

  // ============================================
  // Scroll
  // ============================================

  private scrollToBottom(): void {
    const { state } = this.deps;
    if (!state.autoScrollEnabled) return;
    if (!(this.deps.getSettings().enableAutoScroll ?? true)) return;
    const messagesEl = this.deps.getMessagesEl();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

// ── Diff data extraction from runner protocol meta payload ──

function extractDiffDataFromMeta(meta: unknown, toolCall: ToolCallInfo): ToolDiffData | null {
  if (!meta || typeof meta !== 'object') return null;

  const m = meta as Record<string, unknown>;
  const raw = m['diffData'] ?? m['diff_data'];
  if (!raw || typeof raw !== 'object') return null;

  const r = raw as Record<string, unknown>;
  const filePath =
    (r['filePath'] as string | undefined) ??
    (toolCall.input.file_path as string | undefined) ??
    '';
  const diffLines = Array.isArray(r['diffLines']) ? (r['diffLines'] as DiffLine[]) : null;
  const stats = r['stats'];
  if (!diffLines || !stats || typeof stats !== 'object') return null;

  return { filePath, diffLines, stats: stats as DiffStats };
}
