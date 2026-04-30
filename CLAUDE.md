# Oddjob — repo + workspace instructions

**What this is:** Oddjob — a task-specific AI agent runtime ("Docker for AI agents"). Single-purpose AI agents defined in declarative TOML "Blueprints"; executed by an `oddjob serve` daemon on cron / webhook / manual triggers; observable through a CLI **and** a React dashboard mounted on the same port.

**Status (April 2026):** v0.0.0 — pre-alpha. Phases 1–18-light shipped + April 2026 re-arch (core/agent/plugins split, typebox throughout, pi-ai unified model provider, plugin-registry tool routing). 479 backend tests pass, single-file binary at `dist/oddjob` (~65 MB, includes dashboard).

**Package layout (post-rearch):** Bun monorepo. `packages/{core,agent,server,api-client,sdk}` + 16 `plugins/*` (tools, channels, envs, sqlite stores, llm) + 2 `apps/*` (`apps/cli`, `apps/dashboard`). Core is types+contracts only; agent owns the runtime AND the 10 internal tools (bash/read/write/edit/grep/find/ls/datetime/javascript/python) under `packages/agent/src/tools/`. Plugins provide everything else (`web_fetch`/`web_search` + backends, channels, envs, model providers, MCP, sqlite stores). Internal tools bypass the plugin registry; plugin-contributed tools resolve through `registry.toolFor(name)`. Single LLM plugin: `pi-models` (~25 pi-ai providers / ~880 models) + `llama-local` for Ollama-style endpoints.

## Where things are

| | |
|---|---|
| Spec (canonical) | `plans/SPEC.md` |
| Implementation plan + Phase 13 (dashboard) | `~/.claude/plans/we-re-going-to-start-compressed-leaf.md` |
| **Implementation status + gotchas + remaining work** | `plans/STATUS.md` ← read this first |
| Workspace README + walkthrough | `README.md` |
| Per-area conventions | `**/CLAUDE.md` |

## Stack invariants

- **Runtime:** Bun ≥ 1.3 only. `bun:sqlite`, `Bun.serve`, `Bun.spawn` used everywhere.
- **Language:** TypeScript strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` + `allowImportingTsExtensions` (we import `./foo.ts` literally).
- **Tests:** `bun:test` only. Unit tests next to file as `*.test.ts`.
- **Type check:** `tsgo` (native preview). `bun run typecheck` from root chains `tsgo --noEmit` for backend + `bun run --cwd apps/dashboard typecheck` for dashboard, because root tsconfig **does not include `apps/**`** (different lib + paths).
- **Lint/format:** `oxlint` + `oxfmt`. ~32 warnings remain by design (no-await-in-loop in sequential migration runners). 0 errors required.
- **Workspaces:** `packages/*`, `plugins/*`, `apps/*`. Workspace deps use `"workspace:*"`.

## Dev workflow

```bash
bun install
bun test                  # 479 tests
bun run typecheck         # tsgo + dashboard tsgo
bun run lint              # oxlint
bun run format            # oxfmt
```

Build single binary:

```bash
bun build --compile --outfile=./dist/oddjob ./apps/cli/src/index.ts
./dist/oddjob serve --port 7777
```

## Running the server

The Oddjob HTTP server + dashboard runs as a `taskmux` task (configured in `taskmux.toml`). Don't `bun apps/cli/src/index.ts serve` directly — use:

```bash
taskmux start server         # start API + dashboard
taskmux restart server       # pick up code changes
taskmux logs server          # tail
taskmux stop server
```

Dashboard mounts at `http://127.0.0.1:7777/` and `http://127.0.0.1:7777/dashboard` (alias). API at `/api/v1/*`.

## Conventions you'll trip over

- **`*.sql` and `*.html` text imports:** SQL migrations and dashboard HTML imported with `import x from "./foo.sql" with { type: "text" }`. Required because `bun build --compile` can't resolve `import.meta.url` filesystem paths inside `/$bunfs/root/`. `*.sql` declaration in each provider (`sql-modules.d.ts`); `*.html` in `packages/server/src/html-modules.d.ts`.
- **Dashboard `apps/dashboard/src/components/*` use relative imports** (`../lib/utils.ts`), not the `@/` alias. Bun's bundler doesn't read per-package tsconfig paths when invoked from repo root via the CLI.
- **`bun --compile` ignores PostCSS.** Tailwind v4 pre-compiled by `bunx @tailwindcss/cli` to `apps/dashboard/src/styles.compiled.css`. **Checked into git** so HTML import resolves at serve time. Don't gitignore it; regenerate via `bun run --cwd apps/dashboard build:css`.
- **citty boolean flags:** `"no-ui"` doesn't bind to `args["no-ui"]` cleanly — citty parses `--no-ui` as negation of `ui`. Pattern: `args: { ui: { type: "boolean", default: true } }`, check `args.ui`.
- **Dashboard auth gap (live):** server doesn't inject a bearer-token meta tag. Localhost no-token works; non-loopback bearer mode would 401 every request. See STATUS.md.
- **Lazy Proxy in `apps/cli/src/lib/api.ts`** for `api.<ns>.<method>(...)` works for direct calls but breaks on reflection (`Object.keys(api.runs)`, `"list" in api.runs`). Don't reflect on it.
- **typebox + Ajv schemas (post-G).** All TOML schemas in `packages/core/src/{blueprint,deployment,environment}/schema.ts` + `apps/cli/src/lib/config.ts` use typebox. Cross-field XOR rules go in second-pass `validateXRefinements` (Ajv handles structure; refines run on validated shape). Defaults inside `Type.Union` arms don't propagate via Ajv's `useDefaults` — make those Optional + nullish-coalesce in parse. For Records with key patterns, use `Type.Unsafe<...>({ patternProperties, additionalProperties: false })` since `Type.Record(Type.String({pattern}), V)` doesn't enforce strict keys. See memory `project_typebox_patterns`.
- **Plugin registry is source of truth for tools (post-H).** Agent loop calls `plugins.toolFor(name)` first, falls back to `buildSingleBuiltinTool` only when `plugins.hasTool(name)` is false. Disabled plugins honor disable (no fallback). Last-wins registration so local plugins override bundled.
- **pi-ai cost is per-million tokens, not per-token.** `Model.cost.input = 15` means $15/M. Don't multiply by 1_000_000 when converting to ModelInfo. The deleted plugin-anthropic divided because pi-ai's old API was per-token; today's API is per-million.

<!-- taskmux:start -->

# Taskmux — oddjob

## Tasks

- **daemon** — `taskmux daemon` (foreground daemon supervising all projects)
- **server** — `bun apps/cli/src/index.ts serve --port 7777` (Oddjob API + dashboard)

## Usage

```bash
taskmux start              # Start all auto_start tasks
taskmux stop               # Stop all tasks
taskmux stop <task>        # Graceful stop (C-c) a single task
taskmux start <task>       # Start a single task
taskmux restart <task>     # Restart a single task
taskmux logs <task>        # Show recent logs
taskmux logs <task> --grep "error"  # Search logs
taskmux inspect <task>     # JSON task state
taskmux status             # Session overview
```

Always use taskmux to manage long-running processes instead of running them directly.

<!-- taskmux:end -->
