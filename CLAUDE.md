# CLAUDE.md

## Project Overview

Cassandra — An Obsidian plugin that provides an AI chat interface via a runner backend (claude-agent-runner). Runner-first, mobile-ready architecture. The vault directory becomes Claude's working directory.

## Commands

```bash
npm run dev        # Development (watch mode)
npm run build      # Production build
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
│   └── logging/             # Structured logger
├── features/
│   ├── chat/                # Main sidebar: view, controllers, renderers, services
│   └── settings/            # Settings tab UI
├── shared/                  # Reusable UI components (modals, dropdowns, icons)
├── utils/                   # Pure utility functions
└── style/                   # Modular CSS
```

### Dependency Rules

```
types/   ← (all modules can import)
logging/ ← (all modules can import)
agent/   ← runner/ (implements the interface)
runner/  ← features/chat/ (consumed by the view layer)
```

Features depend on core, never the reverse. Shared depends on nothing in core/features.

## Development Notes

- **Comments**: Only comment WHY, not WHAT. No JSDoc that restates the function name.
- **TDD**: Red-green-refactor for new functions/modules. Tests mirror `src/` in `tests/unit/`.
- Run `npm run typecheck && npm run lint && npm run test && npm run build` after editing.
- No `console.*` in production code.
- Generated docs/test scripts go in `dev/`.
