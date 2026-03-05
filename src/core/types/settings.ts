/**
 * Cassandra settings — runner-focused, no CLI baggage.
 */

import type { ClaudeModel, ThinkingBudget } from './models';

/** Permission mode for tool execution — matches SDK PermissionMode values. */
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk';

/** User decision from the approval modal. */
export type ApprovalDecision = 'allow' | 'allow-always' | 'deny' | 'cancel';

/** Cassandra plugin settings. */
export interface CassandraSettings {
  // Runner backend
  runnerUrl: string;
  runnerAutoStart: boolean;
  runnerProjectPath: string;

  // Model
  model: ClaudeModel;
  thinkingBudget: ThinkingBudget;

  // Security
  permissionMode: PermissionMode;
  enableVaultRestriction: boolean;

  // Content
  systemPrompt: string;
  compactInstructions: string;
  persistentExternalContextPaths: string[];
  customContextLimits: Record<string, number>;

  // UI
  enableAutoTitleGeneration: boolean;
  enableAutoScroll: boolean;
  maxTabs: number;
}

export const DEFAULT_SETTINGS: CassandraSettings = {
  runnerUrl: 'http://localhost:9080',
  runnerAutoStart: true,
  runnerProjectPath: '',

  model: 'sonnet',
  thinkingBudget: 'low',

  permissionMode: 'default',
  enableVaultRestriction: false,

  systemPrompt: '',
  compactInstructions: '',
  persistentExternalContextPaths: [],
  customContextLimits: {},

  enableAutoTitleGeneration: true,
  enableAutoScroll: true,
  maxTabs: 3,
};
