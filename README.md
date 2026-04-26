# Oddjob

Task-specific AI agent runtime. Define agents declaratively in TOML "Blueprints", run them on cron / webhook / manual triggers via a single `oddjob serve` daemon.

> **Status:** v0.0.0 — pre-alpha, under active development. See `plans/SPEC.md` for the full design.

## Quickstart (planned, not yet implemented)

```bash
oddjob setup
oddjob serve &
oddjob init my-agent
cd my-agent
oddjob run .
```

## Workspace

This is a Bun monorepo. See `packages/` for per-package READMEs.

```
packages/
├── core/         types, blueprint parser, agent loop wrapper
├── server/       Bun.serve HTTP API, webhook ingress, worker pool
├── cli/          oddjob CLI (citty)
├── sdk/          re-exports for plugin authors
└── providers/    pluggable LLM, sandbox, channels, MCP, auth, storage
```

## Development

```bash
bun install
bun test
bun run typecheck
bun run lint
```

## License

MIT — see [LICENSE](./LICENSE).
