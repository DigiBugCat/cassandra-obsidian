/**
 * VaultFileAdapter — Obsidian Vault API wrapper for file operations.
 * Mobile-safe: no Node.js fs/path imports.
 */

import type { App } from 'obsidian';

export class VaultFileAdapter {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private app: App) {}

  async exists(path: string): Promise<boolean> {
    return this.app.vault.adapter.exists(path);
  }

  async read(path: string): Promise<string> {
    return this.app.vault.adapter.read(path);
  }

  async write(path: string, content: string): Promise<void> {
    await this.ensureParentFolder(path);
    await this.app.vault.adapter.write(path, content);
  }

  async append(path: string, content: string): Promise<void> {
    await this.ensureParentFolder(path);
    this.writeQueue = this.writeQueue.then(async () => {
      if (await this.exists(path)) {
        const existing = await this.read(path);
        await this.app.vault.adapter.write(path, existing + content);
      } else {
        await this.app.vault.adapter.write(path, content);
      }
    }).catch(() => {});
    await this.writeQueue;
  }

  async delete(path: string): Promise<void> {
    if (await this.exists(path)) {
      await this.app.vault.adapter.remove(path);
    }
  }

  async listFiles(folder: string): Promise<string[]> {
    if (!(await this.exists(folder))) return [];
    const listing = await this.app.vault.adapter.list(folder);
    return listing.files;
  }

  async ensureFolder(path: string): Promise<void> {
    if (await this.exists(path)) return;
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  // --- Thread organization state ---

  private readonly THREADS_STATE_PATH = '.cassandra/threads.json';

  async readJson<T>(path: string): Promise<T | null> {
    try {
      if (!(await this.exists(path))) return null;
      const content = await this.read(path);
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  async writeJson(path: string, data: unknown): Promise<void> {
    await this.write(path, JSON.stringify(data, null, 2));
  }

  async getThreadOrganizerState(): Promise<{ version: number; folders: any[] } | null> {
    return this.readJson(this.THREADS_STATE_PATH);
  }

  async setThreadOrganizerState(state: { version: number; folders: any[] }): Promise<void> {
    await this.writeJson(this.THREADS_STATE_PATH, state);
  }

  private readonly THREADS_UI_PATH = '.cassandra/threads-ui.json';

  async getThreadsPaneCollapsedSections(): Promise<string[]> {
    const data = await this.readJson<{ collapsed: string[] }>(this.THREADS_UI_PATH);
    return data?.collapsed ?? [];
  }

  async setThreadsPaneCollapsedSections(collapsed: string[]): Promise<void> {
    const existing = await this.readJson<Record<string, unknown>>(this.THREADS_UI_PATH) ?? {};
    await this.writeJson(this.THREADS_UI_PATH, { ...existing, collapsed });
  }

  async getThreadLastViewed(): Promise<Record<string, number>> {
    const data = await this.readJson<{ lastViewed: Record<string, number> }>(this.THREADS_UI_PATH);
    return data?.lastViewed ?? {};
  }

  async setThreadLastViewed(lastViewed: Record<string, number>): Promise<void> {
    const existing = await this.readJson<Record<string, unknown>>(this.THREADS_UI_PATH) ?? {};
    await this.writeJson(this.THREADS_UI_PATH, { ...existing, lastViewed });
  }

  private async ensureParentFolder(filePath: string): Promise<void> {
    const folder = filePath.substring(0, filePath.lastIndexOf('/'));
    if (folder && !(await this.exists(folder))) {
      await this.ensureFolder(folder);
    }
  }
}
