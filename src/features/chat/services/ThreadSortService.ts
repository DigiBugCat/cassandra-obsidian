/**
 * ThreadSortService — auto-sorts threads into folders via LLM suggestion.
 *
 * Builds the classification prompt client-side and sends it via the
 * generic query endpoint on the orchestrator.
 */

import { createLogger } from '../../../core/logging';
import type { RunnerClient } from '../../../core/runner';
import type { SessionStorage } from '../../../core/storage';
import type { ConversationMeta } from '../../../core/types';
import type { ThreadOrganizerService } from './ThreadOrganizerService';

const log = createLogger('ThreadSortService');

const FOLDER_SYSTEM_PROMPT = `You categorize conversations into folders.

Given a conversation title, preview, and a list of existing folder names, decide where to place it.

**Rules**:
1. If it fits an existing folder, respond: EXISTING: <folder name>
2. If no folder fits, suggest a new one: NEW: <short category name>
3. New folder names should be 1-3 words, general enough to hold multiple conversations (e.g., "Code Review", "Research", "DevOps", "Data Analysis").
4. Do NOT create overly specific folders. Prefer broad categories.

**Output**: Return ONLY one line: either "EXISTING: <name>" or "NEW: <name>". Nothing else.`;

function buildFolderPrompt(title: string, preview: string, folders: string[]): string {
  const folderList = folders.length > 0
    ? folders.map(f => `- ${f}`).join('\n')
    : '(no existing folders)';
  return `Title: ${title}\nPreview: ${preview}\n\nExisting folders:\n${folderList}\n\nWhich folder should this conversation go in?`;
}

function parseFolderSuggestion(text: string): { type: 'existing' | 'new'; folderName: string } {
  const trimmed = text.trim();
  const existingMatch = trimmed.match(/^EXISTING:\s*(.+)$/i);
  if (existingMatch) return { type: 'existing', folderName: existingMatch[1].trim() };
  const newMatch = trimmed.match(/^NEW:\s*(.+)$/i);
  if (newMatch) return { type: 'new', folderName: newMatch[1].trim() };
  return { type: 'new', folderName: trimmed.substring(0, 30) };
}

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

    const meta = await this.deps.storage.load(conversationId);
    if (!meta?.runnerSessionId) {
      log.warn('sort_no_runner_session', { conversationId });
      return false;
    }

    const title = conv.title || 'New conversation';
    const preview = conv.preview || '';

    const folders = await this.deps.organizer.getFolders();
    const folderNames = folders.map(f => f.name);

    try {
      const client = this.deps.getRunnerClient();
      const prompt = buildFolderPrompt(title, preview, folderNames);
      const text = await client.query(meta.runnerSessionId, prompt, {
        systemPrompt: FOLDER_SYSTEM_PROMPT,
        model: 'haiku',
      });
      const result = parseFolderSuggestion(text);

      log.info('sort_result', { conversationId, type: result.type, folderName: result.folderName });

      if (result.type === 'existing') {
        const folder = folders.find(f => f.name.toLowerCase() === result.folderName.toLowerCase());
        if (folder) {
          await this.deps.organizer.assignToFolder(conversationId, folder.id);
          return true;
        }
      }

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
