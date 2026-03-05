# AGENTS.md

## Project Overview

Cassandra — An Obsidian plugin that provides an AI chat interface via a runner backend (Codex-agent-runner). Runner-first, mobile-ready architecture. The vault directory becomes Codex's working directory.

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

### Working (verified in Obsidian via CLI)
- Plugin loads, enables, ribbon icon + command
- Runner connection: WS connect, session create via HTTP, subscribe via WS
- Messages send and responses arrive (confirmed: "Hello there, how are you?")
- Event pipeline: RunnerService → transformRunnerEvent → StreamEvent → CassandraView
- Text dedup: `sawStreamText` skips duplicate assistant text when stream deltas present
- Usage calculation: context = input + cache tokens (matches SDK path)
- Debug logging: all levels to console via `createLogger()`
- Permission mode mapping: Cassandra `'normal'` → SDK `'default'`
- Hot-reload via `.hotreload` file + Obsidian CLI `plugin:reload`

### Known Issues

#### Token-level streaming — FIXED
Two patches applied to the runner Docker image (see `patches/patches/v2-streaming/README.md`):

1. **SDK patch** (`sdk.mjs`): V2's `SQ` constructor hard-coded `includePartialMessages: false`.
   Changed to read from options: `Q.includePartialMessages??!1`.

2. **CLI patch** (`cli-patched.js`): CLI enforced `--include-partial-messages requires --print`.
   V2 interactive mode uses `--input-format stream-json` (not `--print`), but the underlying
   `stream_event` yield code works fine in interactive mode. Removed the `--print` requirement.

Verified end-to-end: `stream_event` types now flow through the pipeline
(`system` → `stream_event`* → `assistant` → `stream_event`* → `result`).
The `sawStreamText` dedup correctly skips the assembled `assistant` text.

#### Multiple WS connections on reload
Each plugin reload creates new WS connections without fully cleaning up old ones. The
RunnerClient reconnect logic creates stale subscriptions. Not critical but adds noise.

### Runner Docker Image
- Rebuilt 2026-03-04: CLI 2.1.63, SDK 0.2.63, patches compiled against 2.1.63
- Dockerfile at `Codex-agent-runner/packages/runner/Dockerfile` — CLI version pinned on lines 5 and 42
- Patched CLI works end-to-end (confirmed via HTTP API: multi-turn with context retention)
- Token streaming: 2 patches (SDK `sdk.mjs` + CLI `cli-patched.js`) enable `stream_event` in V2
- Deployed via k3d: `k3d image import Codex-runner:latest -c Codex-runner`

## Migration Plan

Migrating from Claudian (frozen). Cherry-picking clean modules, rewriting entangled ones.
Master plan: `~/.Codex/plans/rosy-stirring-piglet.md`

### Phase 1: Scaffold — DONE
### Phase 2: Runner Core — DONE

Token streaming fixed — two patches in runner Dockerfile (SDK + CLI).

### Phase 3: Chat UI (next)
- Copy renderers from Claudian (MessageRenderer, ToolCallRenderer, ThinkingBlockRenderer, DiffRenderer)
- Copy controllers (ConversationController, StreamController, InputController)
- Copy state management
- CSS: port from Claudian with `cassandra-` prefix
- Replace `path.basename()` / `path.extname()` with pure JS helpers
- **Milestone: full chat experience with tool calls, thinking, diffs**

### Phase 4: Storage + Sessions
- VaultFileAdapter (Obsidian API, mobile-safe)
- StorageService (sans migration), SessionStorage, SettingsStorage
- CCSettingsStorage, SlashCommandStorage, SkillStorage
- Settings tab (CassandraSettings — fresh, runner-focused)
- **Milestone: sessions persist across restarts, settings work**

### Phase 5: Features
- Tabs (TabManager, TabBar) + Thread tree tabs
- Threads sidebar (all conversations, expandable tree)
- @-mentions + slash commands
- Fork/rewind
- Approval UI (permission modal)
- File context + thinking blocks
- **Milestone: feature parity with Claudian runner path**

### Phase 6: SDK Fallback (desktop only)
- SDKAgentService (quarantined, gated behind Platform.isMobile)
- SecurityHooks, HookExecutor (desktop-only)
- **Milestone: works without runner on desktop**

### Phase 7: Polish + Mobile
- Logger: injectable sink (console on mobile, file on desktop)
- Docker auto-start (desktop guard)
- Remove all `claudian` references
- Test on iOS Obsidian
