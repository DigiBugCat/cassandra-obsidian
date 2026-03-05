/**
 * Chat state management — pure data, no Obsidian imports.
 *
 * Separates runtime state (messages, streaming control, usage) from
 * render context (DOM anchors, tool tracking maps). Runtime state survives
 * across tab switches; render context resets each streaming turn.
 */

import type { ChatMessage, DiffLine, ToolCallInfo, UsageInfo } from '../../../core/types';

// ── Renderer types (forward-declared to avoid circular deps) ──

export interface ThinkingBlockState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  labelEl: HTMLElement;
  content: string;
  startTime: number;
  timerInterval: ReturnType<typeof setInterval> | null;
  isExpanded: boolean;
}

export interface WriteEditState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  headerEl: HTMLElement;
  nameEl: HTMLElement;
  summaryEl: HTMLElement;
  statsEl: HTMLElement;
  statusEl: HTMLElement;
  toolCall: ToolCallInfo;
  isExpanded: boolean;
  diffLines?: DiffLine[];
}

export interface PendingToolCall {
  toolCall: ToolCallInfo;
  parentEl: HTMLElement | null;
}

// ── State interfaces ──

interface ChatRuntimeState {
  messages: ChatMessage[];
  isStreaming: boolean;
  cancelRequested: boolean;
  activeToolCallCount: number;
  streamGeneration: number;
  usage: UsageInfo | null;
  autoScrollEnabled: boolean;
  responseStartTime: number | null;
  flavorTimerInterval: ReturnType<typeof setInterval> | null;
}

interface ChatRenderContext {
  currentContentEl: HTMLElement | null;
  currentTextEl: HTMLElement | null;
  currentTextContent: string;
  currentThinkingState: ThinkingBlockState | null;
  thinkingEl: HTMLElement | null;
  thinkingIndicatorTimeout: ReturnType<typeof setTimeout> | null;
  toolCallElements: Map<string, HTMLElement>;
  writeEditStates: Map<string, WriteEditState>;
  pendingTools: Map<string, PendingToolCall>;
  hookElements: Map<string, HTMLElement>;
}

interface ChatStateData extends ChatRuntimeState, ChatRenderContext {}

export interface ChatStateCallbacks {
  onMessagesChanged?: () => void;
  onStreamingStateChanged?: (isStreaming: boolean) => void;
  onUsageChanged?: (usage: UsageInfo | null) => void;
  onAutoScrollChanged?: (enabled: boolean) => void;
}

// ── Initial state factory ──

function createInitialState(): ChatStateData {
  return {
    messages: [],
    isStreaming: false,
    cancelRequested: false,
    activeToolCallCount: 0,
    streamGeneration: 0,
    usage: null,
    autoScrollEnabled: true,
    responseStartTime: null,
    flavorTimerInterval: null,
    currentContentEl: null,
    currentTextEl: null,
    currentTextContent: '',
    currentThinkingState: null,
    thinkingEl: null,
    thinkingIndicatorTimeout: null,
    toolCallElements: new Map(),
    writeEditStates: new Map(),
    pendingTools: new Map(),
    hookElements: new Map(),
  };
}

// ── ChatState class ──

export class ChatState {
  private state: ChatStateData;
  private _callbacks: ChatStateCallbacks;

  constructor(callbacks: ChatStateCallbacks = {}) {
    this.state = createInitialState();
    this._callbacks = callbacks;
  }

  get callbacks(): ChatStateCallbacks { return this._callbacks; }
  set callbacks(value: ChatStateCallbacks) { this._callbacks = value; }

  // ── Messages ──

  get messages(): ChatMessage[] { return [...this.state.messages]; }
  set messages(value: ChatMessage[]) {
    this.state.messages = value;
    this._callbacks.onMessagesChanged?.();
  }

  addMessage(msg: ChatMessage): void {
    this.state.messages.push(msg);
    this._callbacks.onMessagesChanged?.();
  }

  clearMessages(): void {
    this.state.messages = [];
    this._callbacks.onMessagesChanged?.();
  }

  getPersistedMessages(): ChatMessage[] {
    return this.state.messages;
  }

  // ── Streaming control ──

  get isStreaming(): boolean { return this.state.isStreaming; }
  set isStreaming(value: boolean) {
    this.state.isStreaming = value;
    this._callbacks.onStreamingStateChanged?.(value);
  }

  get cancelRequested(): boolean { return this.state.cancelRequested; }
  set cancelRequested(value: boolean) { this.state.cancelRequested = value; }

  get activeToolCallCount(): number { return this.state.activeToolCallCount; }
  set activeToolCallCount(value: number) { this.state.activeToolCallCount = value; }

  get streamGeneration(): number { return this.state.streamGeneration; }
  bumpStreamGeneration(): number {
    this.state.streamGeneration += 1;
    return this.state.streamGeneration;
  }

  // ── Usage ──

  get usage(): UsageInfo | null { return this.state.usage; }
  set usage(value: UsageInfo | null) {
    this.state.usage = value;
    this._callbacks.onUsageChanged?.(value);
  }

  // ── Auto-scroll ──

  get autoScrollEnabled(): boolean { return this.state.autoScrollEnabled; }
  set autoScrollEnabled(value: boolean) {
    const changed = this.state.autoScrollEnabled !== value;
    this.state.autoScrollEnabled = value;
    if (changed) this._callbacks.onAutoScrollChanged?.(value);
  }

  // ── Response timer ──

  get responseStartTime(): number | null { return this.state.responseStartTime; }
  set responseStartTime(value: number | null) { this.state.responseStartTime = value; }

  get flavorTimerInterval(): ReturnType<typeof setInterval> | null { return this.state.flavorTimerInterval; }
  set flavorTimerInterval(value: ReturnType<typeof setInterval> | null) { this.state.flavorTimerInterval = value; }

  clearFlavorTimerInterval(): void {
    if (this.state.flavorTimerInterval) {
      clearInterval(this.state.flavorTimerInterval);
      this.state.flavorTimerInterval = null;
    }
  }

  // ── Streaming DOM state ──

  get currentContentEl(): HTMLElement | null { return this.state.currentContentEl; }
  set currentContentEl(value: HTMLElement | null) { this.state.currentContentEl = value; }

  get currentTextEl(): HTMLElement | null { return this.state.currentTextEl; }
  set currentTextEl(value: HTMLElement | null) { this.state.currentTextEl = value; }

  get currentTextContent(): string { return this.state.currentTextContent; }
  set currentTextContent(value: string) { this.state.currentTextContent = value; }

  get currentThinkingState(): ThinkingBlockState | null { return this.state.currentThinkingState; }
  set currentThinkingState(value: ThinkingBlockState | null) { this.state.currentThinkingState = value; }

  get thinkingEl(): HTMLElement | null { return this.state.thinkingEl; }
  set thinkingEl(value: HTMLElement | null) { this.state.thinkingEl = value; }

  get thinkingIndicatorTimeout(): ReturnType<typeof setTimeout> | null { return this.state.thinkingIndicatorTimeout; }
  set thinkingIndicatorTimeout(value: ReturnType<typeof setTimeout> | null) { this.state.thinkingIndicatorTimeout = value; }

  // ── Tool tracking maps ──

  get toolCallElements(): Map<string, HTMLElement> { return this.state.toolCallElements; }
  get writeEditStates(): Map<string, WriteEditState> { return this.state.writeEditStates; }
  get pendingTools(): Map<string, PendingToolCall> { return this.state.pendingTools; }
  get hookElements(): Map<string, HTMLElement> { return this.state.hookElements; }

  // ── Resets ──

  resetStreamingState(): void {
    this.state.currentContentEl = null;
    this.state.currentTextEl = null;
    this.state.currentTextContent = '';
    this.state.currentThinkingState = null;
    this.state.isStreaming = false;
    this.state.cancelRequested = false;
    this.state.activeToolCallCount = 0;
    if (this.state.thinkingIndicatorTimeout) {
      clearTimeout(this.state.thinkingIndicatorTimeout);
      this.state.thinkingIndicatorTimeout = null;
    }
    this.clearFlavorTimerInterval();
    this.state.responseStartTime = null;
  }

  clearMaps(): void {
    this.state.toolCallElements.clear();
    this.state.writeEditStates.clear();
    this.state.pendingTools.clear();
    this.state.hookElements.clear();
  }

  resetForNewConversation(): void {
    this.clearMessages();
    this.resetStreamingState();
    this.clearMaps();
    this.usage = null;
    this.autoScrollEnabled = true;
  }
}
