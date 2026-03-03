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

### Working
- Plugin scaffold (loads in Obsidian, ribbon icon, command)
- Runner connection (WebSocket + HTTP to claude-agent-runner)
- Session creation, subscription, message sending
- Minimal chat UI (header, messages, input, send button)
- Event streaming pipeline (transformRunnerEvent → StreamEvent)
- Text dedup (sawStreamText prevents duplicate assistant text)
- Usage calculation (context = input + cache tokens)
- Debug logging (all levels to console)

### Runner Issue
The runner's SDK subprocess crashes with exit code 1 (infrastructure/API key issue in Docker container). This is a runner-side issue, not Cassandra. Claudian would have the same problem.

### Next: Phase 3+ (see plan below)

## Migration Plan

Migrating from Claudian (frozen). Cherry-picking clean modules, rewriting entangled ones.

### Phase 3: Storage + Sessions
- VaultFileAdapter (Obsidian API, mobile-safe)
- SessionStorage (JSONL metadata)
- SettingsStorage + Settings tab
- Conversation persistence across restarts

### Phase 4: Chat UI Enhancement
- Renderers: MessageRenderer, ToolCallRenderer, ThinkingBlockRenderer, DiffRenderer
- Controllers: ConversationController, StreamController, InputController
- CSS: port from Claudian with `cassandra-` prefix

### Phase 5: Thread Tree Tabs
- TabManager scoped to active conversation's thread tree
- Main thread + live subagent/fork tabs
- Threads sidebar (all conversations, expandable tree)

### Phase 6: Features
- @-mentions + slash commands
- Fork/rewind
- Approval UI (permission modal)
- File context
- Thinking blocks

### Phase 7: SDK Fallback (desktop only)
- SDKAgentService (quarantined, gated behind Platform.isMobile)
- SecurityHooks, HookExecutor (desktop-only)

### Phase 8: Polish + Mobile
- Logger: file sink on desktop, console on mobile
- Docker auto-start (desktop guard)
- Remove all `claudian` references
- Test on iOS Obsidian
