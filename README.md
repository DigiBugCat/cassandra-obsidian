# Cassandra — Obsidian AI Chat

An Obsidian plugin that provides an AI chat interface powered by a [Claude Agent Runner](https://github.com/DigiBugCat/claude-agent-runner) backend. Runner-first, mobile-ready architecture — the vault directory becomes Claude's working directory.

## Features

- **Streaming chat** with token-level output via WebSocket
- **Multi-tab sessions** with fork, rewind, and history
- **Tool call rendering** — diffs, write/edit, subagents, thinking blocks
- **Composer** — model selector, thinking toggle, image paste/drop, file @-mentions
- **Permission protocol** — Allow/Deny/Always modal for tool approvals
- **Obsidian Sync** — optional bidirectional vault sync to runner containers
- **Mobile-ready** — 44px touch targets, click-to-toggle dropdowns

## Prerequisites

A running [Claude Agent Runner](https://github.com/DigiBugCat/claude-agent-runner) instance. The plugin connects to the runner's HTTP/WebSocket API.

## Setup

1. Clone into your Obsidian vault's `.obsidian/plugins/` directory:
   ```bash
   cd /path/to/vault/.obsidian/plugins
   git clone https://github.com/DigiBugCat/cassandra-obsidian.git
   ```

2. Install and build:
   ```bash
   cd cassandra-obsidian
   npm install
   npm run build
   ```

3. Enable the plugin in Obsidian Settings → Community Plugins.

4. Configure the runner URL in plugin settings (default: `http://localhost:9080`).

## Development

```bash
npm run dev        # Watch mode
npm run build      # Production build
npm run typecheck  # Type check
npm run lint       # Lint
npm run test       # Run tests
```

## Architecture

See [CLAUDE.md](CLAUDE.md) for full architecture details, module map, and dependency rules.

## License

[MIT](LICENSE)
