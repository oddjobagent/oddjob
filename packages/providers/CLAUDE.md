# packages/providers

Pluggable backends. Each implements an interface from `@oddjob/core/src/providers/*.ts`.

| Provider           | Interface           | Notes                                                                                                                                                                          |
| ------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `llm-pi`           | n/a (helper class)  | Wraps `@mariozechner/pi-ai`. Resolves `openrouter/...`, `faux/...`, native `<provider>/<model>`. Uses pi's registry first, falls back to constructed openai-completions Model. |
| `sandbox-process`  | `SandboxProvider`   | `Bun.spawn` + isolated tempdir + abort signal + capped stdout/stderr. **Not a real sandbox** — trusted local blueprints only.                                                  |
| `state-sqlite`     | `StateProvider`     | Blueprints, deployments, runs, KV memory, connector tokens. SQL embedded via text import.                                                                                      |
| `queue-sqlite`     | `QueueProvider`     | Atomic `UPDATE…RETURNING` dequeue, lease + heartbeat + reclaimStale, ack/nack require workerId                                                                                 |
| `queue-memory`     | `QueueProvider`     | In-process for tests                                                                                                                                                           |
| `secrets-sqlite`   | `SecretsProvider`   | AES-256-GCM with **secret name as AAD** (closes ciphertext-swap class). Master key from OS keyring or env fallback.                                                            |
| `logging-sqlite`   | `LogProvider`       | `since` cursor + `level` filter. Dashboard log tail uses `since` to avoid re-downloading 1000 entries per tick.                                                                |
| `scheduler-croner` | `SchedulerProvider` | `croner` with `protect: true` (no overlapping runs)                                                                                                                            |
| `mcp-client`       | `McpProvider`       | stdio + Streamable HTTP + SSE. Tool name allowlist filtering. **OAuth lifecycle deferred** to Phase 9b.                                                                        |
| `channel-console`  | `ChannelProvider`   | stdout                                                                                                                                                                         |
| `channel-slack`    | `ChannelProvider`   | Incoming webhook URL OR bot token, blocks rendering                                                                                                                            |
| `channel-email`    | `ChannelProvider`   | **Resend only** in v1 (no SMTP/nodemailer yet)                                                                                                                                 |
| `channel-webhook`  | `ChannelProvider`   | Generic POST + HMAC-SHA256 (`x-oddjob-signature`)                                                                                                                              |
| `storage-local`    | `StorageProvider`   | **Stub** — Phase 13+                                                                                                                                                           |
| `auth-local`       | `AuthProvider`      | **Stub** — Phase 9b OAuth lifecycle                                                                                                                                            |
| `llm-anthropic`    | `LLMProvider`       | **Stub** — pi-ai already covers Anthropic                                                                                                                                      |

## Migrations: text-imported SQL

All four `*-sqlite` providers do:

```ts
import sql0001 from "./migrations/0001_*.sql" with { type: "text" };
```

(plus a `sql-modules.d.ts` for tsgo). This embeds SQL in the bundle so `bun build --compile` works — previously the runner did `fs.readdir("./migrations")` which fails inside the `/$bunfs/root/` runtime FS.

There are 4 near-duplicate runners. TODO to dedupe into a shared helper (STATUS.md P4).

## Provider testing pattern

```ts
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-X-"));
  p = new XSqliteProvider({ path: join(dir, "x.db") });
  await p.connect();
});
afterAll(async () => {
  await p.disconnect();
  await rm(dir, { recursive: true, force: true });
});
```

The MCP live test is gated on `ODDJOB_LIVE_MCP=1` (needs `npx` + network).
