# apps/

User-facing apps that consume the Oddjob API. Decoupled from the daemon by design — no `apps/*` package may import `@oddjob/server` or any server-side provider. They talk HTTP only.

| App | Purpose |
|---|---|
| `dashboard` | React 19 + TanStack Query + Tailwind v4 + shadcn-style components. Mounted by `oddjob serve` at `/` and `/dashboard`. Can also run standalone via `bun run --cwd apps/dashboard dev`. |

## Decoupling rules

1. `apps/*/package.json` may depend on `@oddjob/api-client` and `@oddjob/core` (types only) — nothing else from this monorepo.
2. No Bun runtime built-ins (`bun:sqlite`, `Bun.spawn`, `Bun.file`).
3. Bundles are produced by Bun's HTML imports OR `bun build --target=browser`. Never via `bun build` for backend.
4. The "split" story is preserved: at any future point we can host the dashboard on a separate static origin (Caddy, S3, Vercel) and point it at any Oddjob API URL via `?api=...` (gated behind `localStorage.ODDJOB_ALLOW_API_OVERRIDE=1`).
