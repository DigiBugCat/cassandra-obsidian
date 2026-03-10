/**
 * SessionStorage — persists conversation metadata and messages to vault/.cassandra/sessions/.
 *
 * Each conversation has two files:
 *   <id>.meta.json     — lightweight metadata for history listing
 *   <id>.messages.json  — full message array for offline restore
 */

import type { ChatMessage, ConversationMeta, UsageInfo } from '../types';
import type { VaultFileAdapter } from './VaultFileAdapter';

export const SESSIONS_PATH = '.cassandra/sessions';

/** Metadata stored per session. */
export interface SessionMetadata {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastResponseAt?: number;
  runnerSessionId: string | null;
  usage?: UsageInfo;
  titleGenerationStatus?: 'pending' | 'success' | 'failed';
  messageCount: number;
  preview: string;
  threadFolderId?: string | null;
  threadPinned?: boolean;
  threadArchived?: boolean;
  model?: string;
}

export class SessionStorage {
  constructor(private adapter: VaultFileAdapter) {}

  async save(meta: SessionMetadata): Promise<void> {
    const filePath = `${SESSIONS_PATH}/${meta.id}.meta.json`;
    await this.adapter.write(filePath, JSON.stringify(meta, null, 2));
  }

  async load(id: string): Promise<SessionMetadata | null> {
    const filePath = `${SESSIONS_PATH}/${id}.meta.json`;
    try {
      if (!(await this.adapter.exists(filePath))) return null;
      const content = await this.adapter.read(filePath);
      return JSON.parse(content) as SessionMetadata;
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    await this.adapter.delete(`${SESSIONS_PATH}/${id}.meta.json`);
    await this.adapter.delete(`${SESSIONS_PATH}/${id}.messages.json`);
  }

  async saveMessages(id: string, messages: ChatMessage[]): Promise<void> {
    // Strip base64 image data to keep files small
    const lightweight = messages.map(m => {
      if (!m.images?.length) return m;
      return { ...m, images: m.images.map(img => ({ ...img, data: '' })) };
    });
    await this.adapter.write(
      `${SESSIONS_PATH}/${id}.messages.json`,
      JSON.stringify(lightweight),
    );
  }

  async loadMessages(id: string): Promise<ChatMessage[]> {
    const filePath = `${SESSIONS_PATH}/${id}.messages.json`;
    try {
      if (!(await this.adapter.exists(filePath))) return [];
      const content = await this.adapter.read(filePath);
      return JSON.parse(content) as ChatMessage[];
    } catch {
      return [];
    }
  }

  async updateMeta(id: string, partial: Partial<SessionMetadata>): Promise<void> {
    const existing = await this.load(id);
    if (!existing) return;
    await this.save({ ...existing, ...partial, id });
  }

  async list(): Promise<ConversationMeta[]> {
    const metas: ConversationMeta[] = [];
    try {
      const files = await this.adapter.listFiles(SESSIONS_PATH);
      for (const filePath of files) {
        if (!filePath.endsWith('.meta.json')) continue;
        try {
          const content = await this.adapter.read(filePath);
          const meta = JSON.parse(content) as SessionMetadata;
          metas.push({
            id: meta.id,
            title: meta.title,
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt,
            lastResponseAt: meta.lastResponseAt,
            messageCount: meta.messageCount,
            preview: meta.preview,
            titleGenerationStatus: meta.titleGenerationStatus,
            threadFolderId: meta.threadFolderId,
            threadPinned: meta.threadPinned,
            threadArchived: meta.threadArchived,
          });
        } catch { /* skip corrupt files */ }
      }
      metas.sort((a, b) => (b.lastResponseAt ?? b.updatedAt) - (a.lastResponseAt ?? a.updatedAt));
    } catch { /* empty dir */ }
    return metas;
  }
}
