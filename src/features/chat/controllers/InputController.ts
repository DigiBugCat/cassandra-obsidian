import type { AgentService } from '../../../core/agent';
import { createLogger } from '../../../core/logging';
import type { ChatMessage, ImageAttachment } from '../../../core/types';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import type { ChatState } from '../state';
import type { StreamController } from './StreamController';

const logger = createLogger('InputController');

export interface InputControllerDeps {
  state: ChatState;
  getService: () => AgentService | null;
  streamController: StreamController;
  renderer: MessageRenderer;
  getInputEl: () => HTMLTextAreaElement | null;
  getSendBtn: () => HTMLElement | null;
  getMessagesEl: () => HTMLElement;
  getImages?: () => ImageAttachment[];
  clearImages?: () => void;
  getContextXml?: () => string;
  clearFileContext?: () => void;
  onSessionStale?: () => Promise<boolean>;
}

export class InputController {
  private deps: InputControllerDeps;

  constructor(deps: InputControllerDeps) {
    this.deps = deps;
  }

  // ============================================
  // Send
  // ============================================

  async handleSend(): Promise<void> {
    const { state, streamController, renderer } = this.deps;

    // Guard: already streaming, no service, or no input
    if (state.isStreaming) {
      logger.debug('handleSend: already streaming, ignoring');
      return;
    }

    const service = this.deps.getService();
    if (!service) {
      logger.warn('handleSend: no agent service available');
      return;
    }

    const inputEl = this.deps.getInputEl();
    const prompt = inputEl?.value.trim() ?? '';
    const images = this.deps.getImages?.() ?? [];
    if (!prompt && images.length === 0) return;

    // Prepend file context XML if present
    const contextXml = this.deps.getContextXml?.() ?? '';

    // Clear input, images, and file context immediately
    if (inputEl) inputEl.value = '';
    this.deps.clearImages?.();
    this.deps.clearFileContext?.();

    // Transition to streaming state
    state.isStreaming = true;
    state.cancelRequested = false;

    // Build user message
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
      images: images.length > 0 ? images : undefined,
    };
    state.addMessage(userMsg);
    renderer.addMessage(userMsg);

    // Build assistant placeholder
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    state.addMessage(assistantMsg);
    const msgEl = renderer.addMessage(assistantMsg);

    // Anchor the streaming DOM target
    state.currentContentEl = msgEl.querySelector('.cassandra-message-content') as HTMLElement | null;
    state.responseStartTime = performance.now();

    // Capture this turn's generation counter so stale events can be discarded
    const gen = state.bumpStreamGeneration();

    streamController.showThinkingIndicator();

    logger.debug('handleSend: starting stream', { prompt: prompt.slice(0, 60), gen });

    try {
      const fullPrompt = contextXml ? contextXml + prompt : prompt;
      const stream = service.query(fullPrompt, images.length > 0 ? images : undefined);
      for await (const chunk of stream) {
        // Discard events from a previous generation (e.g. after cancel + new send)
        if (state.streamGeneration !== gen) {
          logger.debug('handleSend: orphan event discarded', { gen, current: state.streamGeneration });
          break;
        }
        if (state.cancelRequested) {
          logger.debug('handleSend: cancel requested, breaking');
          break;
        }
        await streamController.handleStreamEvent(chunk, assistantMsg);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('handleSend: stream error', { message });

      // Auto-recover stale/stopped sessions
      const isStale = /session (has )?stop/i.test(message) || /session not found/i.test(message);
      if (isStale && this.deps.onSessionStale) {
        logger.info('handleSend: stale session detected, auto-recovering');
        const recovered = await this.deps.onSessionStale();
        if (recovered) {
          assistantMsg.content += '\n\n> Session expired — new session created. Please resend your message.';
        } else {
          assistantMsg.content += `\n\n> Error: ${message}`;
        }
      } else {
        assistantMsg.content += `\n\n> Error: ${message}`;
      }
    } finally {
      streamController.hideThinkingIndicator();
      streamController.finalizeCurrentTextBlock(assistantMsg);
      streamController.finalizeCurrentThinkingBlock(assistantMsg);

      const wasInterrupted = state.cancelRequested;
      if (wasInterrupted) {
        assistantMsg.content += '\n\n*Interrupted*';
      }

      assistantMsg.durationSeconds = Math.floor(
        (performance.now() - (state.responseStartTime ?? 0)) / 1000,
      );

      state.currentContentEl = null;
      state.isStreaming = false;
      state.cancelRequested = false;
      state.activeToolCallCount = 0;
      streamController.resetStreamingState();

      logger.debug('handleSend: stream finished', {
        interrupted: wasInterrupted,
        duration: assistantMsg.durationSeconds,
      });
    }
  }

  // ============================================
  // Cancel
  // ============================================

  cancelStreaming(): void {
    const { state, streamController } = this.deps;

    if (!state.isStreaming) return;

    logger.debug('cancelStreaming: requesting cancel');
    state.cancelRequested = true;
    this.deps.getService()?.cancel();
    streamController.hideThinkingIndicator();
  }
}
