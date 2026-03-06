import type { App } from 'obsidian';
import { Menu, setIcon } from 'obsidian';

import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type { ConversationMeta } from '../../../core/types';
import { confirm } from '../../../shared/ConfirmModal';
import { promptText } from '../../../shared/PromptModal';
import type { ThreadOrganizerService } from '../services/ThreadOrganizerService';
import type { ThreadSearchIndex } from '../services/ThreadSearchIndex';
import type { ThreadSortService } from '../services/ThreadSortService';

export interface ThreadRuntimeState {
  isActive: boolean;
  isStreaming: boolean;
  needsAttention: boolean;
}

export interface ThreadsPaneDeps {
  app: App;
  adapter: VaultFileAdapter;
  organizer: ThreadOrganizerService;
  searchIndex: ThreadSearchIndex;
  sortService: ThreadSortService;
  getConversationList: () => ConversationMeta[];
  updateConversation: (id: string, partial: Partial<ConversationMeta>) => Promise<void>;
}

export interface ThreadsPaneCallbacks {
  getActiveConversationId: () => string | null;
  getRuntimeState: (conversationId: string) => ThreadRuntimeState | null;
  onOpenConversation: (conversationId: string) => Promise<void>;
  onForkConversation: (conversationId: string) => Promise<void>;
  onCompactAndForkConversation: (conversationId: string) => Promise<void>;
  onCreateThreadInFolder: (folderId: string) => Promise<void>;
  onCreateThreadUnsorted: () => Promise<void>;
  onRefreshRequest?: () => void;
}

interface RenderSection {
  id: string;
  title: string;
  threads: ConversationMeta[];
  folderId: string | null;
  isSystem?: boolean;
  archivedSection?: boolean;
}

const SECTION_ID_UNSORTED = 'system-unsorted';
const SECTION_ID_ARCHIVED = 'system-archived';

/**
 * Hierarchical threads organizer panel for Cassandra.
 *
 * This UI is intentionally separate from Obsidian's built-in file explorer.
 */
export class ThreadsPane {
  private containerEl: HTMLElement;
  private deps: ThreadsPaneDeps;
  private callbacks: ThreadsPaneCallbacks;
  private bodyEl: HTMLElement;
  private searchInputEl: HTMLInputElement;
  private searchDropdownEl: HTMLElement | null = null;
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private collapsedSections: Map<string, boolean> = new Map();
  private renderToken = 0;
  private draggedFolderId: string | null = null;
  private draggedThreadId: string | null = null;
  private lastViewedMap: Record<string, number> = {};

  constructor(containerEl: HTMLElement, deps: ThreadsPaneDeps, callbacks: ThreadsPaneCallbacks) {
    this.containerEl = containerEl;
    this.deps = deps;
    this.callbacks = callbacks;
    this.containerEl.empty();
    this.containerEl.addClass('cassandra-threads-pane');

    // Load persisted collapsed state and last-viewed timestamps
    void this.loadCollapsedState();
    void this.loadLastViewedMap();

    const headerEl = this.containerEl.createDiv({ cls: 'cassandra-threads-pane-header' });
    const titleEl = headerEl.createDiv({ cls: 'cassandra-threads-pane-title' });
    titleEl.setText('Threads');

    const actionsEl = headerEl.createDiv({ cls: 'cassandra-threads-pane-actions' });

    const markReadBtn = actionsEl.createEl('button', {
      cls: 'clickable-icon cassandra-threads-pane-btn',
      attr: { 'aria-label': 'Mark all as read', title: 'Mark all as read' },
    });
    setIcon(markReadBtn, 'check-check');
    markReadBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.markAllAsRead();
    });

    const newThreadBtn = actionsEl.createEl('button', {
      cls: 'clickable-icon cassandra-threads-pane-btn',
      attr: { 'aria-label': 'New thread in Unsorted', title: 'New thread' },
    });
    setIcon(newThreadBtn, 'square-plus');
    newThreadBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.callbacks.onCreateThreadUnsorted();
      await this.refresh();
    });

    const autosortBtn = actionsEl.createEl('button', {
      cls: 'clickable-icon cassandra-threads-pane-btn',
      attr: { 'aria-label': 'Autosort unsorted threads', title: 'Autosort unsorted' },
    });
    setIcon(autosortBtn, 'wand-sparkles');
    autosortBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      autosortBtn.addClass('is-loading');
      try {
        await this.deps.sortService.sortUnsorted();
      } finally {
        autosortBtn.removeClass('is-loading');
      }
      await this.refresh();
    });

    const newFolderBtn = actionsEl.createEl('button', {
      cls: 'clickable-icon cassandra-threads-pane-btn',
      attr: { 'aria-label': 'New folder', title: 'New folder' },
    });
    setIcon(newFolderBtn, 'folder-plus');
    newFolderBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = await promptText(this.deps.app, 'New folder', 'Folder name');
      if (!name) return;
      await this.deps.organizer.createFolder(name);
      await this.refresh();
    });

    const searchEl = this.containerEl.createDiv({ cls: 'cassandra-threads-search' });
    const searchWrapper = searchEl.createDiv({ cls: 'cassandra-threads-search-wrapper' });
    this.searchInputEl = searchWrapper.createEl('input', {
      cls: 'cassandra-threads-search-input',
      attr: { type: 'text', placeholder: 'Search threads…', spellcheck: 'false' },
    });
    const clearBtn = searchWrapper.createEl('button', {
      cls: 'cassandra-threads-search-clear',
      attr: { 'aria-label': 'Clear search' },
    });
    setIcon(clearBtn, 'x');
    clearBtn.addEventListener('click', () => {
      this.searchInputEl.value = '';
      this.hideSearchDropdown();
      this.searchInputEl.focus();
    });
    this.searchInputEl.addEventListener('input', () => {
      if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);

      const query = this.searchInputEl.value.trim();
      clearBtn.style.display = query ? '' : 'none';
      if (!query) {
        this.hideSearchDropdown();
        return;
      }

      // Instant title matches
      this.showSearchResults(query, false);

      // Auto-escalate to deep search after 500ms
      this.searchDebounceTimer = setTimeout(() => {
        void this.showSearchResults(query, true);
      }, 500);
    });
    clearBtn.style.display = 'none';
    this.searchInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.searchInputEl.value = '';
        clearBtn.style.display = 'none';
        this.hideSearchDropdown();
      }
    });

    this.bodyEl = this.containerEl.createDiv({ cls: 'cassandra-threads-pane-body' });
    void this.refresh();
  }

  private async showSearchResults(query: string, includeDeep: boolean): Promise<void> {
    const q = query.toLocaleLowerCase();
    const conversations = this.deps.getConversationList();

    // Title matches (instant)
    const titleMatches = conversations.filter(c =>
      (c.title ?? '').toLocaleLowerCase().includes(q),
    ).slice(0, 10);

    // Deep content matches
    let deepMatches: ConversationMeta[] = [];
    if (includeDeep) {
      const deepIds = await this.deps.searchIndex.search(query);
      const titleIds = new Set(titleMatches.map(c => c.id));
      deepMatches = deepIds
        .filter(id => !titleIds.has(id))
        .map(id => conversations.find(c => c.id === id))
        .filter((c): c is ConversationMeta => !!c)
        .slice(0, 10);
    }

    this.renderSearchDropdown(titleMatches, deepMatches, includeDeep);
  }

  private renderSearchDropdown(
    titleMatches: ConversationMeta[],
    deepMatches: ConversationMeta[],
    deepSearchDone: boolean,
  ): void {
    if (!this.searchDropdownEl) {
      // Insert before bodyEl so it takes its flex slot
      this.searchDropdownEl = this.containerEl.createDiv({ cls: 'cassandra-threads-search-dropdown' });
      this.containerEl.insertBefore(this.searchDropdownEl, this.bodyEl);
    }
    this.searchDropdownEl.empty();
    this.searchDropdownEl.style.display = 'flex';
    this.searchDropdownEl.style.flexDirection = 'column';
    this.bodyEl.style.display = 'none';

    if (titleMatches.length === 0 && deepMatches.length === 0) {
      this.searchDropdownEl.createDiv({
        cls: 'cassandra-threads-search-empty',
        text: deepSearchDone ? 'No results found' : 'Searching…',
      });
      return;
    }

    if (titleMatches.length > 0) {
      this.searchDropdownEl.createDiv({ cls: 'cassandra-threads-search-section-label', text: 'Title matches' });
      for (const conv of titleMatches) {
        this.renderSearchResult(conv, conv.preview);
      }
    }

    if (deepMatches.length > 0) {
      this.searchDropdownEl.createDiv({ cls: 'cassandra-threads-search-section-label', text: 'Content matches' });
      for (const conv of deepMatches) {
        this.renderSearchResult(conv, conv.preview);
      }
    } else if (!deepSearchDone && titleMatches.length > 0) {
      this.searchDropdownEl.createDiv({
        cls: 'cassandra-threads-search-hint',
        text: 'Searching content…',
      });
    }
  }

  private renderSearchResult(conv: ConversationMeta, preview: string): void {
    if (!this.searchDropdownEl) return;

    const rowEl = this.searchDropdownEl.createDiv({ cls: 'cassandra-threads-search-result' });
    rowEl.createDiv({ cls: 'cassandra-threads-search-result-title', text: conv.title || 'New conversation' });
    if (preview) {
      const previewText = preview.length > 80 ? preview.slice(0, 80) + '…' : preview;
      rowEl.createDiv({ cls: 'cassandra-threads-search-result-preview', text: previewText });
    }

    rowEl.addEventListener('click', async () => {
      this.hideSearchDropdown();
      this.searchInputEl.value = '';
      await this.callbacks.onOpenConversation(conv.id);
    });
  }

  private hideSearchDropdown(): void {
    if (this.searchDropdownEl) {
      this.searchDropdownEl.style.display = 'none';
    }
    this.bodyEl.style.display = '';
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
  }

  destroy(): void {
    this.containerEl.empty();
    this.containerEl.removeClass('cassandra-threads-pane');
  }

  async refresh(): Promise<void> {
    const token = ++this.renderToken;
    const folders = await this.deps.organizer.getFolders();
    if (token !== this.renderToken) return;

    const conversations = [...this.deps.getConversationList()].sort((a, b) => {
      return (b.lastResponseAt ?? b.updatedAt ?? b.createdAt) - (a.lastResponseAt ?? a.updatedAt ?? a.createdAt);
    });

    // Keep active conversation marked as viewed so it never shows unread
    const activeId = this.callbacks.getActiveConversationId();
    if (activeId) {
      this.lastViewedMap[activeId] = Date.now();
    }

    this.bodyEl.empty();

    const activeThreads = conversations.filter(c => !c.threadArchived);
    const archivedThreads = conversations.filter(c => !!c.threadArchived);

    const unsortedThreads = activeThreads.filter(c => !c.threadFolderId);

    const sections: RenderSection[] = [
      {
        id: SECTION_ID_UNSORTED,
        title: 'Unsorted',
        threads: unsortedThreads,
        folderId: null,
        isSystem: true,
      },
      ...folders.map((folder) => ({
        id: folder.id,
        title: folder.name,
        threads: activeThreads.filter(c => c.threadFolderId === folder.id),
        folderId: folder.id,
      })),
      {
        id: SECTION_ID_ARCHIVED,
        title: 'Archived',
        threads: archivedThreads,
        folderId: null,
        isSystem: true,
        archivedSection: true,
      },
    ];

    // Store folders for context menu use
    this.currentFolders = folders;

    for (const section of sections) {
      if (section.id === SECTION_ID_ARCHIVED && !this.collapsedSections.has(section.id)) {
        this.collapsedSections.set(section.id, true);
      }
      this.renderSection(section);
    }
  }

  private currentFolders: Array<{ id: string; name: string }> = [];

  private renderSection(section: RenderSection): void {
    const wrapperEl = this.bodyEl.createDiv({ cls: 'cassandra-threads-section' });
    const headerEl = wrapperEl.createDiv({ cls: 'cassandra-threads-section-header' });

    const collapsed = this.collapsedSections.get(section.id) ?? false;
    const chevronEl = headerEl.createSpan({ cls: 'cassandra-threads-section-chevron' });
    setIcon(chevronEl, collapsed ? 'chevron-right' : 'chevron-down');

    const titleEl = headerEl.createSpan({ cls: 'cassandra-threads-section-title', text: section.title });
    titleEl.setAttribute('title', section.title);

    headerEl.createSpan({
      cls: 'cassandra-threads-section-count',
      text: String(section.threads.length),
    });

    const actionsEl = headerEl.createDiv({ cls: 'cassandra-threads-section-actions' });

    if (section.folderId) {
      // Make folder sections draggable for reordering
      wrapperEl.setAttribute('draggable', 'true');
      wrapperEl.dataset.folderId = section.folderId;
      wrapperEl.addClass('cassandra-threads-section-draggable');

      wrapperEl.addEventListener('dragstart', (e) => {
        this.draggedFolderId = section.folderId;
        wrapperEl.addClass('is-dragging');
        e.dataTransfer?.setData('text/plain', section.folderId!);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });

      wrapperEl.addEventListener('dragend', () => {
        this.draggedFolderId = null;
        wrapperEl.removeClass('is-dragging');
        this.bodyEl.querySelectorAll('.is-drag-over').forEach(el => el.removeClass('is-drag-over'));
      });

      wrapperEl.addEventListener('dragover', (e) => {
        if (!this.draggedFolderId || this.draggedFolderId === section.folderId) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        wrapperEl.addClass('is-drag-over');
      });

      wrapperEl.addEventListener('dragleave', () => {
        wrapperEl.removeClass('is-drag-over');
      });

      wrapperEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        wrapperEl.removeClass('is-drag-over');
        if (!this.draggedFolderId || this.draggedFolderId === section.folderId) return;

        // Collect current folder order from DOM, insert dragged before drop target
        const allSectionEls = this.bodyEl.querySelectorAll('.cassandra-threads-section-draggable');
        const currentOrder: string[] = [];
        for (const el of allSectionEls) {
          const fid = (el as HTMLElement).dataset.folderId;
          if (fid && fid !== this.draggedFolderId) currentOrder.push(fid);
        }
        // Insert dragged folder before the drop target
        const dropIdx = currentOrder.indexOf(section.folderId!);
        if (dropIdx !== -1) {
          currentOrder.splice(dropIdx, 0, this.draggedFolderId);
        }
        this.draggedFolderId = null;
        await this.deps.organizer.reorderFolders(currentOrder);
        await this.refresh();
      });

      const createBtn = actionsEl.createEl('button', {
        cls: 'clickable-icon cassandra-threads-section-move-btn',
        attr: { 'aria-label': `New thread in ${section.title}`, title: 'New thread' },
      });
      setIcon(createBtn, 'plus');
      createBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.callbacks.onCreateThreadInFolder(section.folderId!);
        await this.refresh();
      });

      const renameBtn = actionsEl.createEl('button', {
        cls: 'clickable-icon cassandra-threads-section-move-btn',
        attr: { 'aria-label': `Rename folder ${section.title}`, title: 'Rename folder' },
      });
      setIcon(renameBtn, 'pencil');
      renameBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = await promptText(this.deps.app, 'Rename folder', 'Folder name', section.title);
        if (!name) return;
        await this.deps.organizer.renameFolder(section.folderId!, name);
        await this.refresh();
      });

      const deleteBtn = actionsEl.createEl('button', {
        cls: 'clickable-icon cassandra-threads-section-move-btn cassandra-threads-pane-btn-danger',
        attr: { 'aria-label': `Delete folder ${section.title}`, title: 'Delete folder' },
      });
      setIcon(deleteBtn, 'trash-2');
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const shouldDelete = await confirm(
          this.deps.app,
          `Delete folder "${section.title}"? Threads will move to Unsorted.`,
          'Delete',
        );
        if (!shouldDelete) return;
        await this.deps.organizer.deleteFolder(section.folderId!);
        await this.refresh();
      });
    }

    headerEl.addEventListener('click', () => {
      this.collapsedSections.set(section.id, !collapsed);
      void this.persistCollapsedState();
      void this.refresh();
    });

    // Right-click context menu on folder headers
    if (section.folderId) {
      headerEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showFolderContextMenu(e, section);
      });
    }

    // Thread drop target (accept thread drags into this section)
    if (!section.archivedSection) {
      wrapperEl.addEventListener('dragover', (e) => {
        if (!this.draggedThreadId || this.draggedFolderId) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        wrapperEl.addClass('is-thread-drag-over');
      });

      wrapperEl.addEventListener('dragleave', () => {
        wrapperEl.removeClass('is-thread-drag-over');
      });

      wrapperEl.addEventListener('drop', async (e) => {
        wrapperEl.removeClass('is-thread-drag-over');
        if (!this.draggedThreadId || this.draggedFolderId) return;
        e.preventDefault();
        e.stopPropagation();

        const threadId = this.draggedThreadId;
        const targetFolderId = section.folderId;
        this.draggedThreadId = null;

        await this.deps.organizer.assignToFolder(threadId, targetFolderId);
        await this.refresh();
      });
    }

    const bodyEl = wrapperEl.createDiv({ cls: 'cassandra-threads-section-body' });
    if (collapsed) {
      // When collapsed, still show pinned threads
      const pinnedInSection = section.threads.filter(t => !!t.threadPinned);
      if (pinnedInSection.length > 0) {
        for (const thread of pinnedInSection) {
          this.renderThreadRow(bodyEl, thread, !!section.archivedSection);
        }
      } else {
        bodyEl.style.display = 'none';
      }
      return;
    }

    if (section.threads.length === 0) {
      bodyEl.createDiv({
        cls: 'cassandra-threads-empty',
        text: section.archivedSection ? 'No archived threads' : 'No threads',
      });
      return;
    }

    for (const thread of section.threads) {
      this.renderThreadRow(bodyEl, thread, !!section.archivedSection);
    }
  }

  private renderThreadRow(containerEl: HTMLElement, conversation: ConversationMeta, archivedRow: boolean): HTMLElement {
    const runtime = this.callbacks.getRuntimeState(conversation.id);
    const isActive = runtime?.isActive || this.callbacks.getActiveConversationId() === conversation.id;
    const isStreaming = runtime?.isStreaming ?? false;
    const needsAttention = runtime?.needsAttention ?? false;

    const isPinned = !!conversation.threadPinned;
    const lastViewed = this.lastViewedMap[conversation.id] ?? 0;
    const isUnread = !isActive && !!conversation.lastResponseAt && conversation.lastResponseAt > lastViewed;
    const rowEl = containerEl.createDiv({
      cls: `cassandra-thread-row${isActive ? ' is-active' : ''}${isPinned ? ' is-pinned' : ''}${needsAttention ? ' is-attention' : ''}${isUnread ? ' is-unread' : ''}`,
    });

    // Make thread rows draggable for moving between folders
    if (!archivedRow) {
      rowEl.setAttribute('draggable', 'true');
      rowEl.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        this.draggedThreadId = conversation.id;
        this.draggedFolderId = null;
        rowEl.addClass('is-dragging');
        e.dataTransfer?.setData('text/plain', conversation.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      rowEl.addEventListener('dragend', () => {
        this.draggedThreadId = null;
        rowEl.removeClass('is-dragging');
        this.bodyEl.querySelectorAll('.is-thread-drag-over').forEach(el => el.removeClass('is-thread-drag-over'));
      });
    }

    const dotEl = rowEl.createSpan({
      cls: `cassandra-thread-row-dot ${
        isActive ? 'is-active' : needsAttention ? 'is-attention' : isStreaming ? 'is-streaming' : isUnread ? 'is-unread' : 'is-idle'
      }`,
    });
    dotEl.setAttribute('aria-hidden', 'true');

    const textWrapEl = rowEl.createDiv({ cls: 'cassandra-thread-row-body' });
    const title = conversation.title?.trim() || 'New conversation';
    const titleEl = textWrapEl.createDiv({ cls: 'cassandra-thread-row-title' });
    if (isPinned) {
      const pinIcon = titleEl.createSpan({ cls: 'cassandra-thread-row-pin-icon' });
      setIcon(pinIcon, 'pin');
    }
    titleEl.appendText(title);

    const metaLine = textWrapEl.createDiv({ cls: 'cassandra-thread-row-meta' });
    const metaLabel = isStreaming ? 'running…' : this.formatThreadTime(conversation);
    metaLine.setText(metaLabel);

    const actionsEl = rowEl.createDiv({ cls: 'cassandra-thread-row-actions' });

    if (!archivedRow) {
      const forkBtn = actionsEl.createEl('button', {
        cls: 'clickable-icon cassandra-thread-action-btn',
        attr: { 'aria-label': 'Fork thread', title: 'Fork thread' },
      });
      setIcon(forkBtn, 'git-fork');
      forkBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.callbacks.onForkConversation(conversation.id);
        await this.refresh();
      });

      const pinBtn = actionsEl.createEl('button', {
        cls: `clickable-icon cassandra-thread-action-btn${conversation.threadPinned ? ' is-pinned' : ''}`,
        attr: { 'aria-label': conversation.threadPinned ? 'Unpin thread' : 'Pin thread', title: 'Pin thread' },
      });
      setIcon(pinBtn, conversation.threadPinned ? 'pin-off' : 'pin');
      pinBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.deps.organizer.togglePinned(conversation.id);
        await this.refresh();
      });

      const archiveBtn = actionsEl.createEl('button', {
        cls: 'clickable-icon cassandra-thread-action-btn cassandra-thread-action-btn-danger',
        attr: { 'aria-label': 'Archive thread', title: 'Archive thread' },
      });
      setIcon(archiveBtn, 'archive');
      archiveBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.deps.organizer.archive(conversation.id);
        this.callbacks.onRefreshRequest?.();
        await this.refresh();
      });
    } else {
      const restoreBtn = actionsEl.createEl('button', {
        cls: 'clickable-icon cassandra-thread-action-btn',
        attr: { 'aria-label': 'Restore thread', title: 'Restore thread' },
      });
      setIcon(restoreBtn, 'undo-2');
      restoreBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.deps.organizer.restore(conversation.id);
        await this.refresh();
      });
    }

    // Left-click: open conversation
    rowEl.addEventListener('click', async () => {
      await this.callbacks.onOpenConversation(conversation.id);
      this.callbacks.onRefreshRequest?.();
      await this.refresh();
    });

    // Right-click: context menu
    rowEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showThreadContextMenu(e, conversation, archivedRow);
    });

    return rowEl;
  }

  private showFolderContextMenu(e: MouseEvent, section: RenderSection): void {
    const menu = new Menu();

    menu.addItem(item => {
      item.setTitle('Rename folder');
      item.setIcon('pencil');
      item.onClick(async () => {
        const name = await promptText(this.deps.app, 'Rename folder', 'Folder name', section.title);
        if (!name) return;
        await this.deps.organizer.renameFolder(section.folderId!, name);
        await this.refresh();
      });
    });

    menu.addItem(item => {
      item.setTitle('New thread');
      item.setIcon('plus');
      item.onClick(async () => {
        await this.callbacks.onCreateThreadInFolder(section.folderId!);
        await this.refresh();
      });
    });

    menu.addSeparator();

    menu.addItem(item => {
      item.setTitle('Delete folder');
      item.setIcon('trash-2');
      item.onClick(async () => {
        const shouldDelete = await confirm(
          this.deps.app,
          `Delete folder "${section.title}"? Threads will move to Unsorted.`,
          'Delete',
        );
        if (!shouldDelete) return;
        await this.deps.organizer.deleteFolder(section.folderId!);
        await this.refresh();
      });
    });

    menu.showAtMouseEvent(e);
  }

  private showThreadContextMenu(e: MouseEvent, conversation: ConversationMeta, archivedRow: boolean): void {
    const menu = new Menu();

    if (archivedRow) {
      menu.addItem(item => {
        item.setTitle('Restore');
        item.setIcon('undo-2');
        item.onClick(async () => {
          await this.deps.organizer.restore(conversation.id);
          await this.refresh();
        });
      });
      menu.showAtMouseEvent(e);
      return;
    }

    // Move to folder submenu
    const folders = this.currentFolders;
    if (folders.length > 0 || conversation.threadFolderId) {
      // "Move to Unsorted" option (if currently in a folder)
      if (conversation.threadFolderId) {
        menu.addItem(item => {
          item.setTitle('Move to Unsorted');
          item.setIcon('inbox');
          item.onClick(async () => {
            await this.deps.organizer.assignToFolder(conversation.id, null);
            await this.refresh();
          });
        });
      }

      // One item per folder (skip the folder the thread is already in)
      for (const folder of folders) {
        if (folder.id === conversation.threadFolderId) continue;
        menu.addItem(item => {
          item.setTitle(`Move to ${folder.name}`);
          item.setIcon('folder');
          item.onClick(async () => {
            await this.deps.organizer.assignToFolder(conversation.id, folder.id);
            await this.refresh();
          });
        });
      }

      menu.addSeparator();
    }

    // Rename
    menu.addItem(item => {
      item.setTitle('Rename');
      item.setIcon('pencil');
      item.onClick(async () => {
        const currentTitle = conversation.title?.trim() || '';
        const newTitle = await promptText(this.deps.app, 'Rename thread', 'Thread title', currentTitle);
        if (!newTitle) return;
        await this.deps.updateConversation(conversation.id, { title: newTitle });
        await this.refresh();
      });
    });

    // Pin / Unpin
    menu.addItem(item => {
      item.setTitle(conversation.threadPinned ? 'Unpin' : 'Pin');
      item.setIcon(conversation.threadPinned ? 'pin-off' : 'pin');
      item.onClick(async () => {
        await this.deps.organizer.togglePinned(conversation.id);
        await this.refresh();
      });
    });

    // Fork
    menu.addItem(item => {
      item.setTitle('Fork');
      item.setIcon('git-fork');
      item.onClick(async () => {
        await this.callbacks.onForkConversation(conversation.id);
        await this.refresh();
      });
    });

    // Compact & Fork
    menu.addItem(item => {
      item.setTitle('Compact & Fork');
      item.setIcon('shrink');
      item.onClick(async () => {
        await this.callbacks.onCompactAndForkConversation(conversation.id);
        await this.refresh();
      });
    });

    // Autosort
    if (conversation.messageCount > 0) {
      menu.addItem(item => {
        item.setTitle('Autosort');
        item.setIcon('wand-sparkles');
        item.onClick(async () => {
          await this.deps.sortService.sortThread(conversation.id);
          await this.refresh();
        });
      });
    }

    menu.addSeparator();

    // Archive
    menu.addItem(item => {
      item.setTitle('Archive');
      item.setIcon('archive');
      item.onClick(async () => {
        await this.deps.organizer.archive(conversation.id);
        this.callbacks.onRefreshRequest?.();
        await this.refresh();
      });
    });

    menu.showAtMouseEvent(e);
  }

  private formatThreadTime(conversation: ConversationMeta): string {
    const ts = conversation.lastResponseAt ?? conversation.updatedAt ?? conversation.createdAt;
    const deltaMs = Date.now() - ts;
    const deltaSec = Math.floor(deltaMs / 1000);
    if (deltaSec < 60) return `${deltaSec}s`;
    const deltaMin = Math.floor(deltaSec / 60);
    if (deltaMin < 60) return `${deltaMin}m`;
    const deltaHour = Math.floor(deltaMin / 60);
    if (deltaHour < 24) return `${deltaHour}h`;
    const deltaDay = Math.floor(deltaHour / 24);
    return `${deltaDay}d`;
  }

  // ============================================
  // Collapsed State Persistence
  // ============================================

  private async loadCollapsedState(): Promise<void> {
    const ids = await this.deps.adapter.getThreadsPaneCollapsedSections();
    if (ids) {
      this.collapsedSections = new Map(ids.map(id => [id, true]));
    }
  }

  private async persistCollapsedState(): Promise<void> {
    const collapsed: string[] = [];
    for (const [id, isCollapsed] of this.collapsedSections) {
      if (isCollapsed) collapsed.push(id);
    }
    await this.deps.adapter.setThreadsPaneCollapsedSections(collapsed);
  }

  // ============================================
  // Unread / Last Viewed Persistence
  // ============================================

  private async loadLastViewedMap(): Promise<void> {
    const map = await this.deps.adapter.getThreadLastViewed();
    if (map) {
      this.lastViewedMap = map;
    }
  }

  async markViewed(conversationId: string): Promise<void> {
    this.lastViewedMap[conversationId] = Date.now();
    await this.deps.adapter.setThreadLastViewed(this.lastViewedMap);
  }

  async markAllAsRead(): Promise<void> {
    const now = Date.now();
    const conversations = this.deps.getConversationList();
    for (const conv of conversations) {
      if (conv.lastResponseAt) {
        this.lastViewedMap[conv.id] = now;
      }
    }
    await this.deps.adapter.setThreadLastViewed(this.lastViewedMap);
    await this.refresh();
  }
}
