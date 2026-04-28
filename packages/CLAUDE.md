# packages/

Backend packages. Each has its own `package.json`, `tsconfig.json`, `src/`. All depend on `@oddjob/core` for types and provider interfaces.

| Package       | Purpose                                                                                                                             | Notes                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `core`        | Types (Blueprint, Deployment, Run, …), provider interfaces, blueprint TOML parser, agent loop wrapper around pi-mono, skills loader | Browser-safe (no Bun built-ins reachable from types)                                  |
| `api-client`  | Browser-safe typed HTTP client with `createApi({baseUrl, bearerToken})`                                                             | Used by both CLI and dashboard. **Pure fetch** — no Bun, no fs.                       |
| `server`      | `Bun.serve` HTTP API + worker pool + webhook ingress + optional dashboard mount                                                     | Owns the dashboard mount point — see `dashboard-mount.ts`                             |
| `sdk`         | Stub re-export for future plugin authors                                                                                            |                                                                                       |
| `providers/*` | 16 pluggable providers (state, queue, secrets, logs, scheduler, sandbox, channels, MCP, llm-pi, ...)                                | Each implements an interface from `core/src/providers/`. Tests live next to the impl. |

## Cross-cutting rules

- **No package may import `@oddjob/server` except `apps/cli`.** That keeps the dashboard, api-client, and providers separable. CLI lives in `apps/` because it's an end-user entry point, not a library.
- **Providers depend ONLY on `@oddjob/core`** for types/interfaces — never on each other or on `server`.
- **All four SQLite migration runners** (`state-sqlite`, `queue-sqlite`, `secrets-sqlite`, `logging-sqlite`) embed SQL via `import x from "./migrations/0001_*.sql" with { type: "text" }`. There's a near-duplicate runner in each — TODO to dedupe (see STATUS.md P4).
- **`bun:sqlite` is server-only.** Anything that depends on a sqlite provider can't run in the browser. The dashboard depends on `@oddjob/core` for types — that's safe because `core` exports types only and tree-shaking keeps the runtime out.
- **Tests:** `bun test` from any package; provider tests use `mkdtemp` for isolated DB files. The MCP test (`plugins/mcp-client/src/canary.test.ts`) is gated on `ODDJOB_LIVE_MCP=1` (needs `npx`).
