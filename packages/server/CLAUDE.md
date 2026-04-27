# packages/server

Bun.serve HTTP API + worker pool + scheduler glue + optional dashboard mount.

## Architecture

```
startServer({ runtime, dashboard? })
   │
   ├─ refuses to start if non-loopback bind without bearerToken
   ├─ starts WorkerPool (lease-based dequeue, heartbeat, reclaim-stale on boot)
   ├─ restores cron triggers for all active deployments
   └─ Bun.serve({
        routes: dashboardRoutes(html)   // SPA paths only (when dashboard given)
        fetch: regex matcher for /api/v1/* and /webhooks/*
      })
```

**Routing precedence:** Bun's `routes:` matches first. If dashboard is mounted, the SPA paths (`/`, `/dashboard`, `/runs`, etc.) bypass the fetch handler entirely. `/api/*` and `/webhooks/*` always go through fetch where bearer + body parsing happen.

## Auth model (Phase 11+12 fix)

- `isLoopbackBind(rt.config.host)` is computed from the **bind host config**, not the request URL's `Host` header (closes a spoof vector codex flagged).
- Non-loopback bind without a `bearerToken` → server **refuses to start** (throws).
- Loopback + token → token enforced for `/api/*` only.
- Loopback + no token → fully open (the default).

The dashboard does **not** receive a bearer token from the server today. Loopback no-token works; bearer-required mode breaks the dashboard. Plan in STATUS.md is a `/_oddjob/auth` endpoint + dashboard login form.

## Dashboard mount (Phase 13c)

`dashboard-mount.ts` is the **only** server file that knows the dashboard exists. `dashboardRoutes(html)` returns `Record<path, htmlBundle>` for the SPA paths. `StartServerOptions.dashboard?` is opt-in. CLI's `--no-ui` skips it.

The list of SPA paths is hard-coded — when adding new dashboard routes, append to `SPA_PATHS` in `dashboard-mount.ts` so deep-linking + refresh work.

## Worker pool

- `processRun()` inserts a Run row at start with `status: "running"` (so `oddjob run --follow` and the dashboard can poll without 404s)
- If a row already exists (lease reclaim path), it `updateRun` instead of failing on PK conflict
- Heartbeat every `config.heartbeatMs`; abort signal per run; channel delivery on success
- `ack`/`nack` require workerId — stale workers can't kill another worker's live run

## Webhook routing (Phase 11+12 fix)

`/webhooks/<ns>/<name>` matches by:

1. explicit `trigger.path` (with leading `/` stripped) > 2. deployment name > 3. `blueprintId == "<ns>/<name>"`

That ordering means custom deployment names + custom paths both work; the spec's default URL still resolves.

## Testing locally

```bash
# don't run `bun ... serve` directly — use taskmux
taskmux restart server
taskmux logs server --grep "error"
```
