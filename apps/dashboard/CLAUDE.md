# apps/dashboard

React 19 SPA. Mounted by `oddjob serve` on the same port as the API.

## Stack

- React 19
- **TanStack Query v5** — server state, polling, mutations
- **TanStack Router** — code-based, typed routes
- **Tailwind v4** — CSS-first config in `src/styles.css`, **pre-compiled** via `@tailwindcss/cli` to `src/styles.compiled.css` (NOT gitignored — see below)
- **shadcn-style primitives** in `src/components/ui/` (button, card, badge, table, input, skeleton). Manually placed (not via `npx shadcn add` since Bun isn't a supported CLI target).
- lucide icons

## Build pipeline + the styles.compiled.css gotcha

Bun's bundler does **not** run PostCSS plugins. Tailwind v4's `@theme`, `@utility`, `@apply`, `@tailwind` directives are unrecognized in raw form. So:

1. `bunx @tailwindcss/cli -i src/styles.css -o src/styles.compiled.css` (script: `build:css`)
2. `index.html` imports `./styles.compiled.css` — never `styles.css`
3. `styles.compiled.css` is **checked into git** so the HTML import always resolves at serve time (otherwise `bun build --compile` fails)
4. `dev` and `build` scripts run `build:css` first as a prebuild step

If you change Tailwind config or add new utility classes, run `bun run --cwd apps/dashboard build:css` to regenerate.

## Imports

Use **relative paths** (`../components/ui/card.tsx`). The `@/` path alias is declared in the dashboard `tsconfig.json` for IDE goodness, but Bun's bundler doesn't pick it up when invoked from repo root via the CLI. We tried; reverted.

## API client

`src/api/client.ts` constructs `createApi({ baseUrl, bearerToken })` once:

- `baseUrl` defaults to `window.location.origin` (same-origin, the mounted case)
- `?api=` and `localStorage.ODDJOB_API_BASE` are **only honored** when `localStorage.ODDJOB_ALLOW_API_OVERRIDE === "1"`. This guards against bearer-token exfiltration once we add token bootstrapping.
- bearer is read from `<meta name="x-oddjob-token">` — **but the server doesn't inject this yet** (loopback no-token is the default supported mode; bearer-required UI auth is a known gap). See STATUS.md.

## Polling tuning (queries.ts)

| Query                                                                     | Interval                             | Why                                                      |
| ------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| `useHealth`, `useStatus`, `useBlueprints`, `useDeployments`, `useSecrets` | 5s                                   | Cheap; rarely change                                     |
| `useDeployment`                                                           | 3s                                   |                                                          |
| `useRuns` (list)                                                          | 1s if any in-flight, else 3s         | Status-aware via `refetchInterval: q => ...`             |
| `useRun` (detail)                                                         | 1s if running/queued, else stop      |                                                          |
| `useRunLogs`                                                              | 1s, **`since` cursor + accumulator** | Avoids re-downloading the full 1000-entry log every tick |

## Routes (8 today)

`/`, `/dashboard` (alias of `/`), `/runs`, `/runs/$id`, `/deployments`, `/deployments/$id`, `/blueprints`, `/blueprints/$namespace/$name`, `/secrets`.

When adding a new route, also add the path string to `SPA_PATHS` in `packages/server/src/dashboard-mount.ts` so deep-link + refresh works against the mounted server.

## Decoupling guarantees

This package depends ONLY on `@oddjob/api-client` + `@oddjob/core` (types). It must never import:

- `@oddjob/server` or anything under `packages/server/`
- `bun:sqlite`, `Bun.file`, `Bun.spawn`, or any Bun runtime built-in
- Any `@oddjob/*-sqlite` provider package

This preserves the "future split: serve the dashboard from a static host pointing at a remote API" story.

## Dev

```bash
bun run --cwd apps/dashboard build:css       # regenerate Tailwind output
bun run --cwd apps/dashboard dev             # standalone dev server on :3001 with HMR + /api proxy → :7777
bun run --cwd apps/dashboard typecheck
```

For the integrated experience: just restart the server (`taskmux restart server`) and visit `http://127.0.0.1:7777/dashboard`.
