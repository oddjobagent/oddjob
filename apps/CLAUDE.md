# apps/

End-user artifacts (entry points), not libraries. Each app may be published or shipped as a binary.

| App         | Purpose                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli`       | `oddjob` command. Entry point for `bun build --compile` → single binary. Glues server + dashboard for `oddjob serve`.                                                                 |
| `dashboard` | React 19 + TanStack Query + Tailwind v4 + shadcn-style components. Mounted by `oddjob serve` at `/` and `/dashboard`. Can also run standalone via `bun run --cwd apps/dashboard dev`. |

## Decoupling rules

- **`cli`** is the **gluing layer**: it's the only place allowed to depend on both `@oddjob/server` and `apps/dashboard/src/index.html`. The future "split" removes those imports here, not in any package.
- **`dashboard`** must NOT depend on `@oddjob/server` or any server-side provider. Only `@oddjob/api-client` + `@oddjob/core` (types). It talks HTTP only. No Bun built-ins (`bun:sqlite`, `Bun.spawn`, `Bun.file`).
- Dashboard bundles are produced by Bun's HTML imports OR `bun build --target=browser`. The same bundle can be hosted on any static origin (Caddy, S3, Vercel) and point at any Oddjob API URL via `?api=...` (gated behind `localStorage.ODDJOB_ALLOW_API_OVERRIDE=1`).
