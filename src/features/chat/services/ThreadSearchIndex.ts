/**
 * ThreadSearchIndex — full-text search for thread titles and previews.
 *
 * Uses MiniSearch for fast fuzzy search. Indexes title + preview from
 * SessionStorage metadata. Persists to .cassandra/search-index.json.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MiniSearch = require('minisearch');

import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type { ConversationMeta } from '../../../core/types';

const INDEX_PATH = '.cassandra/search-index.json';
const MINISEARCH_OPTIONS = {
  fields: ['title', 'content'],
  storeFields: ['title'],
  searchOptions: {
    boost: { title: 3 },
    prefix: true,
    fuzzy: 0.2,
    combineWith: 'AND' as const,
  },
};

interface PersistedIndex {
  index: any;
  timestamps: Record<string, number>;
}

export class ThreadSearchIndex {
  private adapter: VaultFileAdapter;
  private getConversations: () => Promise<ConversationMeta[]>;
  private miniSearch: any;
  private timestamps = new Map<string, number>();
  private buildPromise: Promise<void> | null = null;
  private built = false;
  private dirty = false;

  constructor(adapter: VaultFileAdapter, getConversations: () => Promise<ConversationMeta[]>) {
    this.adapter = adapter;
    this.getConversations = getConversations;
    this.miniSearch = new MiniSearch(MINISEARCH_OPTIONS);
  }

  async search(query: string): Promise<string[]> {
    if (!this.built) await this.ensureBuilt();
    if (!query.trim()) return [];
    const results = this.miniSearch.search(query);
    return results.map((r: any) => r.id as string);
  }

  invalidate(): void {
    this.built = false;
    this.buildPromise = null;
    this.miniSearch = new MiniSearch(MINISEARCH_OPTIONS);
    this.timestamps.clear();
    this.dirty = true;
  }

  async persist(): Promise<void> {
    if (!this.dirty) return;
    try {
      const data: PersistedIndex = {
        index: this.miniSearch.toJSON(),
        timestamps: Object.fromEntries(this.timestamps),
      };
      await this.adapter.write(INDEX_PATH, JSON.stringify(data));
      this.dirty = false;
    } catch { /* best-effort */ }
  }

  private async ensureBuilt(): Promise<void> {
    if (this.built) return;
    if (this.buildPromise) { await this.buildPromise; return; }
    this.buildPromise = this.build();
    await this.buildPromise;
  }

  private async loadFromDisk(): Promise<boolean> {
    try {
      if (!(await this.adapter.exists(INDEX_PATH))) return false;
      const raw = await this.adapter.read(INDEX_PATH);
      const data: PersistedIndex = JSON.parse(raw);
      if (!data.index || !data.timestamps) return false;
      this.miniSearch = MiniSearch.loadJSON(JSON.stringify(data.index), MINISEARCH_OPTIONS);
      this.timestamps = new Map(Object.entries(data.timestamps));
      return true;
    } catch {
      return false;
    }
  }

  private async build(): Promise<void> {
    const loaded = await this.loadFromDisk();
    const conversations = await this.getConversations();
    const ids = new Set(conversations.map(c => c.id));

    // Remove stale entries
    if (loaded) {
      for (const id of this.timestamps.keys()) {
        if (!ids.has(id)) {
          try { this.miniSearch.discard(id); } catch { /* already removed */ }
          this.timestamps.delete(id);
          this.dirty = true;
        }
      }
    }

    // Index new/changed conversations
    const toIndex = conversations.filter(meta => {
      const cached = this.timestamps.get(meta.id);
      if (!cached) return true;
      return (meta.lastResponseAt ?? meta.updatedAt ?? meta.createdAt) > cached;
    });

    for (const meta of toIndex) {
      if (this.timestamps.has(meta.id)) {
        try { this.miniSearch.discard(meta.id); } catch { /* already removed */ }
      }
      this.miniSearch.add({
        id: meta.id,
        title: meta.title || '',
        content: meta.preview || '',
      });
      this.timestamps.set(meta.id, meta.lastResponseAt ?? meta.updatedAt ?? meta.createdAt);
    }

    if (toIndex.length > 0) this.dirty = true;
    this.built = true;
    this.buildPromise = null;
    void this.persist();
  }
}
