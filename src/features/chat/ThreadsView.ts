import type { WorkspaceLeaf } from 'obsidian';
import { ItemView } from 'obsidian';

import type { SessionStorage } from '../../core/storage';
import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import type { ConversationMeta } from '../../core/types';
import type { ThreadOrganizerService } from './services/ThreadOrganizerService';
import type { ThreadSearchIndex } from './services/ThreadSearchIndex';
import { ThreadsPane } from './ui/ThreadsPane';

export const VIEW_TYPE_THREADS = 'cassandra-threads-view';

export interface ThreadsViewDeps {
  adapter: VaultFileAdapter;
  storage: SessionStorage;
  organizer: ThreadOrganizerService;
  searchIndex: ThreadSearchIndex;
  /** Returns the current in-memory conversation list (synchronous snapshot). */
  getConversationList: () => ConversationMeta[];
  /** Updates a conversation's persisted metadata. */
  updateConversation: (id: string, partial: Partial<ConversationMeta>) => Promise<void>;
  /** Opens the main Cassandra view and activates it. */
  activateMainView: () => Promise<void>;
  /** Opens a specific conversation in the main view. Returns null if not available. */
  openConversation: (conversationId: string) => Promise<void>;
  /** Returns the currently active conversation id, if any. */
  getActiveConversationId: () => string | null;
  /** Forks the given conversation. */
  forkConversation: (conversationId: string) => Promise<void>;
  /** Compact & forks the given conversation. */
  compactAndForkConversation: (conversationId: string) => Promise<void>;
  /** Creates a new unsorted conversation and opens it. */
  createConversationUnsorted: () => Promise<void>;
  /** Creates a new conversation in a folder and opens it. */
  createConversationInFolder: (folderId: string) => Promise<void>;
}

export class ThreadsView extends ItemView {
  private deps: ThreadsViewDeps;
  private threadsPane: ThreadsPane | null = null;

  constructor(leaf: WorkspaceLeaf, deps: ThreadsViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  getViewType(): string {
    return VIEW_TYPE_THREADS;
  }

  getDisplayText(): string {
    return 'Threads';
  }

  getIcon(): string {
    return 'list';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();

    this.threadsPane = new ThreadsPane(
      container,
      {
        app: this.app,
        adapter: this.deps.adapter,
        organizer: this.deps.organizer,
        searchIndex: this.deps.searchIndex,
        getConversationList: this.deps.getConversationList,
        updateConversation: this.deps.updateConversation,
      },
      {
        getActiveConversationId: () => this.deps.getActiveConversationId(),
        getRuntimeState: (_conversationId) => {
          // Cassandra doesn't expose per-conversation runtime state externally yet.
          // Return null — the active conversation check in ThreadsPane covers the main case.
          return null;
        },
        onOpenConversation: async (conversationId) => {
          await this.deps.activateMainView();
          await this.deps.openConversation(conversationId);
          await this.threadsPane?.markViewed(conversationId);
        },
        onForkConversation: async (conversationId) => {
          await this.deps.activateMainView();
          await this.deps.forkConversation(conversationId);
        },
        onCompactAndForkConversation: async (conversationId) => {
          await this.deps.activateMainView();
          await this.deps.compactAndForkConversation(conversationId);
        },
        onCreateThreadUnsorted: async () => {
          await this.deps.activateMainView();
          await this.deps.createConversationUnsorted();
        },
        onCreateThreadInFolder: async (folderId) => {
          await this.deps.activateMainView();
          await this.deps.createConversationInFolder(folderId);
        },
        onRefreshRequest: () => {
          // No-op: ThreadsView doesn't manage the history dropdown or tab state
        },
      },
    );
  }

  async onClose(): Promise<void> {
    this.threadsPane?.destroy();
    this.threadsPane = null;
  }

  async refresh(): Promise<void> {
    await this.threadsPane?.refresh();
  }
}
