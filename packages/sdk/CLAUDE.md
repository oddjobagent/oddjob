# packages/sdk

`@oddjob/sdk` — author-side ergonomics. Two audiences:

1. **Plugin authors** — `definePlugin` builder + re-exports of plugin types from `@oddjob/core`.
2. **Script-mode blueprint authors** — `defineRun` + `Context` interface + `RetryableError` / `PermanentError`.

Blueprint authors should `bun add @oddjob/sdk` and write `main.ts` with `import {defineRun} from "@oddjob/sdk"`. The SDK is a **separate dep**, NOT bundled with `@oddjob/agent` — keeping the runtime free to ship as a single binary while user code links against a versioned SDK.

## Browser-safe contract

This package MUST stay browser-safe:

- No imports from `bun:*` (no `bun:sqlite`, no `Bun.serve`).
- No imports from `node:*` (no `node:fs`, no `node:path`).
- No imports from runtime packages (`@oddjob/agent`, `@oddjob/server`).
- Pure types + tiny runtime helpers (`defineRun`, `assertSerial`).

The dashboard already imports `@oddjob/core` for types — `@oddjob/sdk` extends that pattern. If a feature needs filesystem / process access, it lives in `@oddjob/agent` and is invoked over the IPC dispatch protocol described in `dispatch-protocol.ts`.

## IPC contract (B2.2)

The `Context` interface is shaped as a JSON-RPC contract so the future Python / Go / Deno SDK ports are ports, not redesigns. Every `ctx.*` method maps 1:1 with an `IpcCall` discriminated-union member in `dispatch-protocol.ts`. The `kind` values match the SQL CHECK constraint on `run_events.call_type` exactly — see `plugins/state-sqlite/src/migrations/0012_run_events.sql`.

Wire format: stdin / stdout JSONL (one call or response per line). Reference doc: `/docs/sdk-ipc-contract.md`.

## Concurrent-calls rule (codex round-1 #3)

**Concurrent `ctx.*` calls are forbidden in v1.** The runtime serializes every dispatch through a single in-flight slot. Patterns like `Promise.all([ctx.fork(...), ctx.fork(...)])` throw at the dispatcher with a message naming both call sites.

Why: replay determinism. Each `ctx.*` call writes a `pending` row in `run_events` keyed by `(run_id, seq)`. Concurrent calls would race on `seq` allocation and produce non-deterministic replay order.

Tiny helper for the runtime to wire: `assertSerial()` in `context.ts` returns a single-slot guard with `begin(callSite)` / `end()`. Don't expose this to user code — the dispatcher owns it.

## Determinism contract

Replay (B2.4) replays a run from its `run_events` log. User code MUST NOT reach for non-deterministic primitives directly:

- Use `ctx.now()` instead of `Date.now()` / `new Date()`.
- Use `ctx.uuid()` instead of `crypto.randomUUID()`.
- Use `ctx.random()` instead of `Math.random()`.

The recorded helpers persist their result in `run_events.result_json` so replay returns the same value. Anything else that captures time / randomness / external state breaks replay — document loud in the user-facing SDK README when that ships.

## What's NOT in v1

- `ctx.requestApproval` — Phase C with channel routing.
- Async fork (`wait: "async"`) — YAGNI per locked decisions.
- `ctx.cancel` / `ctx.signal` — out of scope.
- Schema codegen (`oddjob types`) — defers to publishing infra.

## Files

| File | Purpose |
|---|---|
| `src/index.ts` | Public surface — re-exports + `definePlugin`. |
| `src/define-run.ts` | `defineRun` + `RunDefinition` + `isRunDefinition`. |
| `src/context.ts` | `Context` interface, sub-namespaces, `assertSerial`. |
| `src/errors.ts` | `RetryableError` / `PermanentError`. |
| `src/dispatch-protocol.ts` | Pure type-only IPC wire format. |
| `src/index.test.ts` | Surface tests (defineRun, errors, IpcCall narrowing, mock Context, assertSerial). |
| `src/canary.test.ts` | Pre-existing plugin-builder canary. |

## Verify

```bash
cd /Users/n/Projects/OddJob/oddjob
bun test packages/sdk
bun run typecheck
bunx oxlint packages/sdk --quiet
```
