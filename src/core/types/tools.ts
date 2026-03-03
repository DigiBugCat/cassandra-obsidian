/**
 * Tool-related type definitions.
 */

import type { DiffLine, DiffStats } from './diff';

export interface ToolDiffData {
  filePath: string;
  diffLines: DiffLine[];
  stats: DiffStats;
}

export interface AskUserQuestionOption {
  label: string;
  description: string;
}

export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
}

export type AskUserAnswers = Record<string, string>;

export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'queued' | 'running' | 'completed' | 'error' | 'blocked';
  result?: string;
  isExpanded?: boolean;
  diffData?: ToolDiffData;
  resolvedAnswers?: AskUserAnswers;
  subagent?: SubagentInfo;
}

export type ExitPlanModeDecision =
  | { type: 'approve' }
  | { type: 'approve-new-session'; planContent: string }
  | { type: 'feedback'; text: string };

export type ExitPlanModeCallback = (
  input: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<ExitPlanModeDecision | null>;

export type SubagentMode = 'sync' | 'async';

export type AsyncSubagentStatus = 'pending' | 'running' | 'completed' | 'error' | 'orphaned';

export interface SubagentInfo {
  id: string;
  description: string;
  prompt?: string;
  mode?: SubagentMode;
  isExpanded: boolean;
  result?: string;
  status: 'running' | 'completed' | 'error';
  toolCalls: ToolCallInfo[];
  asyncStatus?: AsyncSubagentStatus;
  agentId?: string;
  outputToolId?: string;
  startedAt?: number;
  completedAt?: number;
}
