import {
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_LS,
  TOOL_READ,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
} from './toolNames';

const TOOL_ICONS: Record<string, string> = {
  [TOOL_READ]: 'file-text',
  [TOOL_WRITE]: 'file-plus',
  [TOOL_EDIT]: 'file-pen',
  [TOOL_BASH]: 'terminal',
  [TOOL_GLOB]: 'folder-search',
  [TOOL_GREP]: 'search',
  [TOOL_LS]: 'list',
  [TOOL_WEB_SEARCH]: 'globe',
  [TOOL_WEB_FETCH]: 'download',
  [TOOL_ASK_USER_QUESTION]: 'help-circle',
};

/** Special marker for MCP tools - signals to use custom SVG. */
export const MCP_ICON_MARKER = '__mcp_icon__';

export function getToolIcon(toolName: string): string {
  if (toolName.startsWith('mcp__')) {
    return MCP_ICON_MARKER;
  }
  return TOOL_ICONS[toolName] || 'wrench';
}
