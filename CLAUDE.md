# CLAUDE.md

## Project Overview

Cassandra — An Obsidian plugin that provides an AI chat interface via a runner backend (claude-agent-runner). Runner-first, mobile-ready architecture. The vault directory becomes Claude's working directory.

## Commands

```bash
npm run dev        # Development (watch mode)
npm run build      # Production build (includes CSS + deploy to vault)
npm run deploy     # Build + deploy to Obsidian vault
npm run typecheck  # Type check
npm run lint       # Lint code
npm run lint:fix   # Lint and auto-fix
npm run test       # Run tests
npm run test:watch # Run tests in watch mode
```

## Architecture

### Principles

1. **Runner-first** — RunnerClient + WebSocket is the primary backend. No Node.js in the hot path.
2. **DI over plugin refs** — Services receive typed config/dependency objects, never the whole plugin.
3. **No `fs`/`os`/`path`/`child_process` in core** — Obsidian APIs for file access, `requestUrl` for HTTP. Node.js only in desktop-gated modules.
4. **Strict type boundaries** — Plugin config, runner protocol, agent events, and UI state are separate type domains. No `any` leaking across boundaries.
5. **Barrel exports** — Import from module, not from internal files (`from '@/core/runner'`, not `from '@/core/runner/RunnerClient'`).

### Module Map

```
src/
├── core/                    # Infrastructure (no feature deps)
│   ├── agent/               # AgentService interface + capabilities
│   ├── runner/              # RunnerClient, RunnerService, protocol types
│   ├── types/               # Shared type definitions (events, chat, models, settings)
│   └── logging/             # Structured logger (injectable sink)
├── features/
│   ├── chat/                # Main sidebar: view, controllers, renderers, services
│   └── settings/            # Settings tab UI
├── shared/                  # Reusable UI components (modals, dropdowns, icons)
├── utils/                   # Pure utility functions
└── style/                   # Modular CSS (base.css, chat.css, etc.)
```

### Dependency Rules

```
types/   ← (all modules can import)
logging/ ← (all modules can import)
agent/   ← runner/ (implements the interface)
runner/  ← features/chat/ (consumed by the view layer)
```

Features depend on core, never the reverse. Shared depends on nothing in core/features.

## Testing with Obsidian CLI

```bash
# Reload plugin after build
obsidian vault="Cassandra-Finance" plugin:reload id=cassandra-obsidian

# Check for errors
obsidian vault="Cassandra-Finance" dev:errors

# Screenshot
obsidian vault="Cassandra-Finance" dev:screenshot path=/tmp/cassandra.png

# Debug console
obsidian vault="Cassandra-Finance" dev:debug on
obsidian vault="Cassandra-Finance" dev:console level=debug

# Inspect DOM
obsidian vault="Cassandra-Finance" dev:dom selector=".cassandra-container" text

# Open the view
obsidian vault="Cassandra-Finance" eval code="app.commands.executeCommandById('cassandra-obsidian:open-cassandra')"

# Send a test message
obsidian vault="Cassandra-Finance" eval code="
const view = app.workspace.getLeavesOfType('cassandra-view')[0].view;
const input = view.containerEl.querySelector('.cassandra-input');
const btn = view.containerEl.querySelector('.cassandra-send-btn');
input.value = 'test message';
btn.click();
"
```

## Development Notes

- **Comments**: Only comment WHY, not WHAT. No JSDoc that restates the function name.
- **TDD**: Red-green-refactor for new functions/modules. Tests mirror `src/` in `tests/unit/`.
- Run `npm run typecheck && npm run lint && npm run test && npm run build` after editing.
- No `console.*` in production code — use `createLogger()` from `@/core/logging`.
- Generated docs/test scripts go in `dev/`.
- Deploy target vault configured in `.env.local` (`OBSIDIAN_VAULT=...`).
- CSS is modular: add files in `src/style/`, import from `src/style/index.css`.

## Current Status

### Implemented
- **Core**: Plugin loads, ribbon icon + command, hot-reload via `.hotreload`
- **Runner connection**: WS connect, session create via HTTP, subscribe via WS
- **Streaming**: Full event pipeline (RunnerService → transformRunnerEvent → StreamEvent → CassandraView), text dedup, token-level streaming via runner patches
- **Chat UI**: MessageRenderer, ToolCallRenderer, WriteEditRenderer, DiffRenderer, ThinkingBlockRenderer, SubagentRenderer
- **Controllers**: StreamController, InputController (Enter sends, Shift+Enter newline, Escape cancels)
- **Composer**: Toolbar (model selector, thinking toggle, token count, refresh, vault restriction, Safe/YOLO toggle), image paste/drop, file @-mentions with chips
- **Tabs**: TabManager, TabBar, multi-tab ChatSession
- **Storage**: VaultFileAdapter, SessionStorage, history dropdown in header
- **Sessions**: Fork/rewind via context menu, stale session auto-recovery
- **Approval**: ApprovalModal (Allow/Deny/Always) for permission requests
- **Settings**: Runner URL, project path, Obsidian Sync, model, thinking, permission mode, vault restriction, MCP servers (JSON), system prompt, compact instructions, UI options
- **Mobile**: Click-to-toggle fallback for model dropdown, 44px touch targets

### Known Issues

#### Multiple WS connections on reload
Each plugin reload creates new WS connections without fully cleaning up old ones. The
RunnerClient reconnect logic creates stale subscriptions. Not critical but adds noise.

### Runner Docker Image
- Rebuilt 2026-03-04: CLI 2.1.63, SDK 0.2.63, patches compiled against 2.1.63
- Dockerfile at `claude-agent-runner/packages/runner/Dockerfile` — CLI version pinned on lines 5 and 42
- Token streaming: 2 patches (SDK `sdk.mjs` + CLI `cli-patched.js`) enable `stream_event` in V2
- Deployed via k3d: `k3d image import claude-runner:latest -c claude-runner`

## Remaining Work

| Feature | Priority | Notes |
|---|---|---|
| **Slash commands** | High | `/` prefix in composer to trigger runner slash commands. `RunnerClient.getCommands()` exists, `SlashCommandDropdown` exists but needs wiring to actually execute commands. |
| **iOS testing** | Medium | Test on actual iOS Obsidian device. |

### Design Decisions
- **MCP servers**: HTTP/SSE transport only. No stdio MCP servers — warm pool stays simple (profile key = vault + agentId), MCP configs are just URLs in `RunnerSessionRequest.mcpServers`.
- **No SDK fallback**: Runner-first architecture only. No desktop-only Node.js SDK backend.
