/**
 * ThreadOrganizerService — manages thread folder organization.
 *
 * Thread folders are Cassandra-only metadata, not Obsidian file folders.
 */

import type { SessionStorage } from '../../../core/storage';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type { ConversationMeta } from '../../../core/types';

export const THREAD_ORGANIZER_VERSION = 1;
export const THREAD_FOLDER_ID_UNSORTED = '__unsorted__';
export const THREAD_FOLDER_ID_ARCHIVED = '__archived__';

export interface ThreadFolder {
  id: string;
  name: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadOrganizerState {
  version: number;
  folders: ThreadFolder[];
}

export interface ThreadOrganizerDeps {
  adapter: VaultFileAdapter;
  storage: SessionStorage;
  getConversationList: () => Promise<ConversationMeta[]>;
  onCreateConversation: (folderId: string | null) => Promise<string>;
}

export class ThreadOrganizerService {
  private deps: ThreadOrganizerDeps;
  private state: ThreadOrganizerState | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(deps: ThreadOrganizerDeps) {
    this.deps = deps;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.state) return;
    if (this.loadPromise) { await this.loadPromise; return; }

    this.loadPromise = (async () => {
      const loaded = await this.deps.adapter.getThreadOrganizerState();
      this.state = (loaded as ThreadOrganizerState) ?? { version: THREAD_ORGANIZER_VERSION, folders: [] };
    })();

    try { await this.loadPromise; } finally { this.loadPromise = null; }
  }

  private async persist(): Promise<void> {
    if (!this.state) return;
    await this.deps.adapter.setThreadOrganizerState(this.state);
  }

  private getNextOrder(): number {
    if (!this.state || this.state.folders.length === 0) return 0;
    return Math.max(...this.state.folders.map(f => f.order)) + 1;
  }

  private dedupeName(name: string): string {
    const normalized = name.trim() || 'New Folder';
    if (!this.state) return normalized;

    const existing = new Set(this.state.folders.map(f => f.name.toLowerCase()));
    if (!existing.has(normalized.toLowerCase())) return normalized;

    let suffix = 2;
    while (existing.has(`${normalized} ${suffix}`.toLowerCase())) suffix++;
    return `${normalized} ${suffix}`;
  }

  async getFolders(): Promise<ThreadFolder[]> {
    await this.ensureLoaded();
    return [...(this.state?.folders ?? [])].sort((a, b) => a.order - b.order);
  }

  async createFolder(name: string): Promise<ThreadFolder> {
    await this.ensureLoaded();
    const now = Date.now();
    const folder: ThreadFolder = {
      id: `folder-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: this.dedupeName(name.trim() || 'New Folder'),
      order: this.getNextOrder(),
      createdAt: now,
      updatedAt: now,
    };
    this.state!.folders.push(folder);
    await this.persist();
    return folder;
  }

  async renameFolder(folderId: string, nextName: string): Promise<ThreadFolder | null> {
    await this.ensureLoaded();
    const folder = this.state!.folders.find(f => f.id === folderId);
    if (!folder) return null;

    const normalized = nextName.trim();
    if (!normalized) return folder;

    const originalName = folder.name;
    folder.name = '';
    folder.name = this.dedupeName(normalized);
    if (!folder.name) folder.name = originalName;
    folder.updatedAt = Date.now();
    await this.persist();
    return folder;
  }

  async deleteFolder(folderId: string): Promise<boolean> {
    await this.ensureLoaded();
    const idx = this.state!.folders.findIndex(f => f.id === folderId);
    if (idx === -1) return false;

    this.state!.folders.splice(idx, 1);

    const convos = await this.deps.getConversationList();
    for (const conv of convos) {
      if (conv.threadFolderId === folderId) {
        await this.deps.storage.updateMeta(conv.id, { threadFolderId: null });
      }
    }

    await this.persist();
    return true;
  }

  async moveFolder(folderId: string, direction: 'up' | 'down'): Promise<void> {
    await this.ensureLoaded();
    const sorted = [...this.state!.folders].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex(f => f.id === folderId);
    if (idx === -1) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const tmp = sorted[idx].order;
    sorted[idx].order = sorted[swapIdx].order;
    sorted[swapIdx].order = tmp;
    await this.persist();
  }

  async reorderFolders(orderedIds: string[]): Promise<void> {
    await this.ensureLoaded();
    for (let i = 0; i < orderedIds.length; i++) {
      const folder = this.state!.folders.find(f => f.id === orderedIds[i]);
      if (folder) folder.order = i;
    }
    await this.persist();
  }

  async assignToFolder(conversationId: string, folderId: string | null): Promise<void> {
    await this.ensureLoaded();
    const validFolderId = folderId && this.state!.folders.some(f => f.id === folderId)
      ? folderId : null;
    await this.deps.storage.updateMeta(conversationId, {
      threadFolderId: validFolderId,
      threadArchived: false,
    });
  }

  async togglePinned(conversationId: string): Promise<boolean> {
    const meta = await this.deps.storage.load(conversationId);
    if (!meta) return false;
    const next = !meta.threadPinned;
    await this.deps.storage.updateMeta(conversationId, { threadPinned: next });
    return next;
  }

  async archive(conversationId: string): Promise<void> {
    await this.deps.storage.updateMeta(conversationId, { threadArchived: true });
  }

  async restore(conversationId: string): Promise<void> {
    await this.deps.storage.updateMeta(conversationId, { threadArchived: false });
  }

  async createInFolder(folderId: string): Promise<string> {
    await this.ensureLoaded();
    const validFolderId = this.state!.folders.some(f => f.id === folderId) ? folderId : null;
    return this.deps.onCreateConversation(validFolderId);
  }

  async createUnsorted(): Promise<string> {
    return this.deps.onCreateConversation(null);
  }
}
