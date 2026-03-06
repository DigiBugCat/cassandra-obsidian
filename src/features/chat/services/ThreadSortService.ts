/**
 * ThreadSortService — auto-sorts threads into folders via LLM suggestion.
 *
 * Calls the orchestrator's suggest-folder endpoint which uses an ephemeral
 * runner with utility_query to classify conversations.
 */

import { createLogger } from '../../../core/logging';
import type { RunnerClient } from '../../../core/runner';
import type { SessionStorage } from '../../../core/storage';
import type { ConversationMeta } from '../../../core/types';
import type { ThreadOrganizerService } from './ThreadOrganizerService';

const log = createLogger('ThreadSortService');

export interface ThreadSortDeps {
  getRunnerClient: () => RunnerClient;
  storage: SessionStorage;
  organizer: ThreadOrganizerService;
  getConversationList: () => ConversationMeta[];
}

export class ThreadSortService {
  private deps: ThreadSortDeps;

  constructor(deps: ThreadSortDeps) {
    this.deps = deps;
  }

  async sortThread(conversationId: string): Promise<boolean> {
    const conversations = this.deps.getConversationList();
    const conv = conversations.find(c => c.id === conversationId);
    if (!conv) {
      log.warn('sort_thread_not_found', { conversationId });
      return false;
    }

    // Look up the runner session id from storage
    const meta = await this.deps.storage.load(conversationId);
    if (!meta?.runnerSessionId) {
      log.warn('sort_no_runner_session', { conversationId });
      return false;
    }

    const title = conv.title || 'New conversation';
    const preview = conv.preview || '';

    // Get existing folder names
    const folders = await this.deps.organizer.getFolders();
    const folderNames = folders.map(f => f.name);

    try {
      const client = this.deps.getRunnerClient();
      const result = await client.suggestFolder(
        meta.runnerSessionId,
        title,
        preview,
        folderNames,
      );

      log.info('sort_result', { conversationId, type: result.type, folderName: result.folderName });

      if (result.type === 'existing') {
        const folder = folders.find(f => f.name.toLowerCase() === result.folderName.toLowerCase());
        if (folder) {
          await this.deps.organizer.assignToFolder(conversationId, folder.id);
          return true;
        }
      }

      // New folder or existing name didn't match exactly
      const newFolder = await this.deps.organizer.createFolder(result.folderName);
      await this.deps.organizer.assignToFolder(conversationId, newFolder.id);
      return true;
    } catch (err) {
      log.warn('sort_failed', { conversationId, error: String(err) });
      return false;
    }
  }

  /** Sort multiple unsorted threads in sequence. */
  async sortUnsorted(): Promise<number> {
    const conversations = this.deps.getConversationList();
    const unsorted = conversations.filter(c =>
      !c.threadFolderId && !c.threadArchived && c.messageCount > 0,
    );

    let sorted = 0;
    for (const conv of unsorted) {
      const ok = await this.sortThread(conv.id);
      if (ok) sorted++;
    }
    return sorted;
  }
}
