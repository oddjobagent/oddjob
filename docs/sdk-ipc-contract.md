# Oddjob SDK — IPC Contract

The `@oddjob/sdk` `Context` interface is shaped as a JSON-RPC contract so the future Python, Go, and Deno SDK ports are *ports*, not redesigns. Every `ctx.*` method maps 1:1 with one `IpcCall` discriminated-union member, and every kind has a stable `{call_type, args, return}` shape that does not depend on TypeScript.

This page is the contract a port implements.

---

## Why IPC-shaped?

A blueprint's `main.ts` (or, eventually, `main.py` / `main.go`) is just a thin program that sits on top of the same wire protocol. The runtime owns the side effects (forking children, calling tools, writing memory, validating output) — user code declares *what* it wants done, and the dispatcher executes it.

This separation gives us three things:

1. **Replay.** Every call writes a row in `run_events`. On restart we replay the log; recorded results are returned without re-executing side effects.
2. **Multi-language.** A Python SDK is a port of the dispatch loop, not a re-spec.
3. **Auditability.** `run_events.args_json` is the canonical record of every side effect a blueprint requested.

---

## Wire format

Framing: stdin / stdout JSONL — one JSON object per line. The runtime spawns the script as a child process; the SDK writes calls to `stdout` and reads responses from `stdin`. Calls and responses are correlated by an opaque numeric `id` allocated by the SDK dispatcher.

```
parent → child:  { "id": 1, "kind": "fork", "args": { "blueprintRef": "acme/fetcher", "inputs": {...} } }
child  → parent: { "id": 1, "ok": true, "result": { "runId": "...", "output": {...}, "costUsd": 0.012 } }
```

Errors:

```
{ "id": 1, "ok": false, "error": { "kind": "permanent", "message": "boom", "retryable": false } }
```

Concurrent calls are forbidden — see *Concurrent-call rule* below.

---

## Method ↔ wire kind map

| `Context.*` method               | `kind`        | `args`                                                                               | `result`                                  |
| -------------------------------- | ------------- | ------------------------------------------------------------------------------------ | ----------------------------------------- |
| `ctx.fork(ref, inputs, opts?)`   | `fork`        | `{ blueprintRef: string, inputs: unknown, wait?: "sync", timeoutMs?: number }`       | `{ runId, output, costUsd }`              |
| `ctx.mcp(server).call(t, a)`     | `mcp`         | `{ server: string, tool: string, args: unknown }`                                    | `unknown`                                 |
| `ctx.tool(name, args)`           | `tool`        | `{ name: string, args: unknown }`                                                    | `unknown`                                 |
| `ctx.sleep(ms)`                  | `sleep`       | `{ ms: number }`                                                                     | `void`                                    |
| `ctx.runAgent(opts)`             | `runAgent`    | `{ prompt, systemPrompt?, tools?, outputSchema?, role?, maxIterations? }`            | `unknown`                                 |
| `ctx.notify(channel, msg)`       | `notify`      | `{ channel: string, message: unknown }`                                              | `void`                                    |
| `ctx.now()`                      | `now`         | `{}`                                                                                 | ISO-8601 UTC string                       |
| `ctx.uuid()`                     | `uuid`        | `{}`                                                                                 | UUID string                               |
| `ctx.random()`                   | `random`      | `{}`                                                                                 | `number` in `[0, 1)`                      |
| `ctx.memory.get(key, schema?)`   | `memory_get`  | `{ key: string, schema?: object }`                                                   | `unknown`                                 |
| `ctx.memory.set(key, val, opts?)`| `memory_set`  | `{ key: string, value: unknown, ttlMs?: number }`                                    | `void`                                    |
| `ctx.scratch.get(key)`           | `scratch_get` | `{ key: string }`                                                                    | `unknown`                                 |
| `ctx.scratch.set(key, val)`      | `scratch_set` | `{ key: string, value: unknown }`                                                    | `void`                                    |
| *reserved (Phase C)*             | `approval`    | `{ prompt: string, channel?: string, timeoutMs?: number }`                           | `{ approved: boolean, reason?: string }`  |
| *reserved (async fork)*          | `waitForRun`  | `{ runId: string, timeoutMs?: number }`                                              | `{ runId, output, costUsd }`              |

The full set of `kind` values is exported from the SDK as `IPC_CALL_KINDS` and matches the SQL CHECK constraint on `run_events.call_type` in `plugins/state-sqlite/src/migrations/0012_run_events.sql` exactly.

---

## Replay determinism

Replay reads `run_events` ordered by `(run_id, seq)`. For each row it asserts `(call_site, call_type, call_args_hash)` match the live call; on match it returns the recorded `result_json`. Mismatch fails loud — silently re-executing would corrupt user state.

User code MUST NOT reach for non-deterministic primitives directly. Use the recorded helpers:

| Forbidden                   | Use instead   |
| --------------------------- | ------------- |
| `Date.now()`, `new Date()`  | `ctx.now()`   |
| `crypto.randomUUID()`       | `ctx.uuid()`  |
| `Math.random()`             | `ctx.random()`|

External state (filesystem, network, env vars) is captured only when reached through `ctx.tool(...)` / `ctx.mcp(...)` / `ctx.fork(...)`. Reading `process.env` directly inside the run function bypasses the log and breaks replay.

The runtime accepts at-least-once semantics for `pending` rows: if a side effect was started but not recorded as `completed`, replay re-executes it. Tools that aren't idempotent should document this loudly.

---

## Concurrent-call rule

**Concurrent `ctx.*` calls are forbidden in v1.** The dispatcher has a single in-flight slot; the second call throws synchronously with a message naming both call sites.

```ts
// FORBIDDEN — throws at the second fork.
await Promise.all([
  ctx.fork("acme/fetcher", { url: u1 }),
  ctx.fork("acme/fetcher", { url: u2 }),
]);
```

Why: each call writes a `pending` row keyed by `(run_id, seq)`. Concurrent dispatch races on `seq` allocation and produces non-deterministic replay order.

Workaround in v1: sequential `await ctx.fork(...)` calls. Concurrent fan-out lands in Phase C alongside `wait: "async"`.

---

## Error semantics

Two error classes, both subclasses of `Error`:

- **`RetryableError`** — transient. Runtime re-queues the run with backoff. Optional `{max, backoffMs}` overrides blueprint policy.
- **`PermanentError`** — fatal. Runtime moves the run to status `error`. No retry.

Any other thrown error is treated as permanent. The wire-format `error.kind` is one of `retryable | permanent | validation | timeout | internal` — port SDKs map their native error types into the same set.

---

## Things NOT in v1

- `ctx.requestApproval` — Phase C with channel routing + dashboard ApprovalUI.
- Async fork (`wait: "async"`) — YAGNI per the locked decisions in the Phase B plan.
- `ctx.cancel` / `ctx.signal` for cooperative cancellation — out of scope.
- Schema codegen (`oddjob types`) — defers to publishing infra.
- Inline blueprints — Phase 4.

---

## Reference

- Wire types: `packages/sdk/src/dispatch-protocol.ts`
- Context interface: `packages/sdk/src/context.ts`
- Errors: `packages/sdk/src/errors.ts`
- `defineRun`: `packages/sdk/src/define-run.ts`
- Replay engine (B2.4): `packages/agent/src/run-events.ts` *(future)*
- Run-event table: `plugins/state-sqlite/src/migrations/0012_run_events.sql`
