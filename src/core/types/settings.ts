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
  runnerProjectPath: string;
  runnerVaultName: string;
  agentName: string;

  // Model
  model: ClaudeModel;
  thinkingBudget: ThinkingBudget;

  // Security
  permissionMode: PermissionMode;
  enableVaultRestriction: boolean;

  // MCP
  mcpServersJson: string;

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
  runnerProjectPath: '',
  runnerVaultName: '',
  agentName: 'cassandra',

  mcpServersJson: '',

  model: 'sonnet',
  thinkingBudget: 'medium',

  permissionMode: 'bypassPermissions',
  enableVaultRestriction: false,

  systemPrompt: '',
  compactInstructions: '',
  persistentExternalContextPaths: [],
  customContextLimits: {},

  enableAutoTitleGeneration: true,
  enableAutoScroll: true,
  maxTabs: 3,
};
