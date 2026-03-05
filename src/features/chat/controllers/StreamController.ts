/**
 * StreamController — owns all stream event dispatch and DOM updates during a streaming turn.
 *
 * NOTE: This is a stub. Full implementation is tracked in Phase 5 (task #7).
 * The interface below is stable — InputController depends on it.
 */

import type { ChatMessage, StreamEvent } from '../../../core/types';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import type { ChatState } from '../state';

export interface StreamControllerDeps {
  state: ChatState;
  renderer: MessageRenderer;
  getMessagesEl: () => HTMLElement;
}

export class StreamController {
  constructor(_deps: StreamControllerDeps) {}

  // ── Called by InputController ──────────────────────────────────────

  /** Show the animated "thinking" indicator in the messages list. */
  showThinkingIndicator(): void {
    // TODO: implement in Phase 5
  }

  /** Hide the "thinking" indicator. */
  hideThinkingIndicator(): void {
    // TODO: implement in Phase 5
  }

  /**
   * Route a single stream event to the appropriate renderer.
   * Called in the async for-await loop inside InputController.handleSend().
   */
  async handleStreamEvent(_chunk: StreamEvent, _msg: ChatMessage): Promise<void> {
    // TODO: implement in Phase 5
  }

  /**
   * Flush and finalize the in-progress markdown text block for msg.
   * Called in the finally block of handleSend().
   */
  finalizeCurrentTextBlock(_msg: ChatMessage): void {
    // TODO: implement in Phase 5
  }

  /**
   * Flush and finalize the in-progress thinking block for msg.
   * Called in the finally block of handleSend().
   */
  finalizeCurrentThinkingBlock(_msg: ChatMessage): void {
    // TODO: implement in Phase 5
  }

  /**
   * Reset all per-turn streaming state (text buffer, thinking state, tool maps).
   * Called after each streaming turn completes or is cancelled.
   */
  resetStreamingState(): void {
    // TODO: implement in Phase 5
  }
}
