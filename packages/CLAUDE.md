# packages/

Backend packages. Each has its own `package.json`, `tsconfig.json`, `src/`. All depend on `@oddjob/core` for types and provider interfaces.

| Package      | Purpose                                                                                                          | Notes                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `core`       | Types, provider interfaces, blueprint/deployment/env parsers, plugin loader, security utils                       | Browser-safe (no Bun built-ins reachable from types)                                 |
| `agent`      | Agent loop, tool registry, system-prompt, output validation, grader, MCP+skill wiring                             | Depends on core; consumed by server + cli                                            |
| `api-client` | Browser-safe typed HTTP client with `createApi({baseUrl, bearerToken})`                                          | Used by both CLI and dashboard. **Pure fetch** — no Bun, no fs.                      |
| `server`     | `Bun.serve` HTTP API + worker pool + webhook ingress + optional dashboard mount                                  | Owns the dashboard mount point — see `dashboard-mount.ts`                            |
| `sdk`        | Stub re-export for future plugin authors                                                                          |                                                                                      |

Provider/tool/channel implementations now live in `plugins/*` (see `../plugins/CLAUDE.md` if present).

## Cross-cutting rules

- **No package may import `@oddjob/server` except `apps/cli`.** That keeps the dashboard, api-client, agent, and plugins separable. CLI lives in `apps/` because it's an end-user entry point, not a library.
- **Plugins depend ONLY on `@oddjob/core`** for types/interfaces (and `@oddjob/agent` for tool factories) — never on each other or on `server`.
- **All four SQLite migration runners** (`state-sqlite`, `queue-sqlite`, `secrets-sqlite`, `logging-sqlite`) embed SQL via `import x from "./migrations/0001_*.sql" with { type: "text" }`. There's a near-duplicate runner in each — TODO to dedupe (see STATUS.md P4).
- **`bun:sqlite` is server-only.** Anything that depends on a sqlite provider can't run in the browser. The dashboard depends on `@oddjob/core` for types — that's safe because `core` exports types only and tree-shaking keeps the runtime out.
- **Tests:** `bun test` from any package; provider tests use `mkdtemp` for isolated DB files. The MCP test (`plugins/mcp-client/src/canary.test.ts`) is gated on `ODDJOB_LIVE_MCP=1` (needs `npx`).
