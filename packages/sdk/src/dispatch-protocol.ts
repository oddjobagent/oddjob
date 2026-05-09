// IPC dispatch protocol — pure type-only definitions of the wire format
// the future Python / Go / Deno SDK ports implement.
//
// Every `Context.*` method maps 1:1 with an `IpcCall` discriminated union
// member. The runtime serializes calls; concurrent `ctx.*` calls are
// forbidden (codex round-1 #3) and error at the dispatcher.
//
// Wire framing: stdin / stdout JSONL (one call or response per line).
//   parent → child: { id: number, kind, args }
//   child  → parent: { id: number, ok: true, result } | { id, ok: false, error }
//
// `id` is opaque to the SDK; the dispatcher assigns + matches it. `kind`
// matches the `call_type` SQL CHECK in `0012_run_events.sql`:
//   fork | mcp | tool | sleep | approval | runAgent | notify
//   now  | uuid | random
//   memory_get | memory_set | scratch_get | scratch_set | waitForRun
//
// The `approval` and `waitForRun` kinds are reserved for Phase C / async
// fork — they are part of the protocol so the schema doesn't need to change
// when those features land, but the v1 SDK does not expose them.

// ---------------------------------------------------------------------------
// Per-kind call args + result types.
// ---------------------------------------------------------------------------

export interface ForkArgs {
  /** Docker-style ref: "ns/name", "ns/name:tag", or "ns/name@version". */
  blueprintRef: string;
  /** Inputs object passed to the child blueprint. JSON-serializable. */
  inputs: unknown;
  /** Sync-only in v1; "async" reserved for Phase C. */
  wait?: "sync";
  /** Optional per-fork timeout (ms). Falls back to deployment policy. */
  timeoutMs?: number;
}

export interface ForkResult {
  /** Child run id; the parent's `parent_run_id` for that row. */
  runId: string;
  /** Validated child output (matches child blueprint outputSchema). */
  output: unknown;
  /** Cost rolled up to the parent via parent_run_id chain. */
  costUsd: number;
}

export interface McpArgs {
  /** MCP server slug as declared in the blueprint connectors map. */
  server: string;
  /** Tool name on that server. */
  tool: string;
  /** JSON-serializable tool arguments. */
  args: unknown;
}

export interface ToolArgs {
  /** Internal tool name (bash/read/write/edit/grep/find/ls/datetime/javascript/python) or plugin tool. */
  name: string;
  /** Tool arguments — shape depends on the tool. */
  args: unknown;
}

export interface SleepArgs {
  ms: number;
}

export interface RunAgentArgs {
  /** Agent prompt (free-form). Mirrors blueprint.prompt for inline runs. */
  prompt: string;
  /** Optional system-prompt override; otherwise composed from blueprint. */
  systemPrompt?: string;
  /** Tools the sub-agent may call. Defaults to the parent blueprint allowlist. */
  tools?: string[];
  /** Output schema (JSON-Schema). Validated structurally before return. */
  outputSchema?: Record<string, unknown>;
  /** Model role. Falls back to deployment default. */
  role?: string;
  /** Max iterations. Defaults to engine policy. */
  maxIterations?: number;
}

export interface NotifyArgs {
  /** Channel slug (console/slack/email/webhook/...). */
  channel: string;
  /** Channel-shaped message. Free-form per channel contract. */
  message: unknown;
}

export interface ApprovalArgs {
  /** Free-form prompt shown to the approver. */
  prompt: string;
  /** Channel for the approval request (slack/email/...). */
  channel?: string;
  /** Per-approval timeout (ms). */
  timeoutMs?: number;
}

export interface MemoryGetArgs {
  key: string;
  /** Optional JSON-Schema validated against the read value. */
  schema?: Record<string, unknown>;
}

export interface MemorySetArgs {
  key: string;
  value: unknown;
  /** Soft TTL (ms); the runtime may evict after expiry. */
  ttlMs?: number;
}

export interface ScratchGetArgs {
  key: string;
}

export interface ScratchSetArgs {
  key: string;
  value: unknown;
}

export interface WaitForRunArgs {
  runId: string;
  /** Per-wait timeout (ms). */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Discriminated union: every Context.* method has one variant.
// ---------------------------------------------------------------------------

export type IpcCall =
  | { id: number; kind: "fork"; args: ForkArgs }
  | { id: number; kind: "mcp"; args: McpArgs }
  | { id: number; kind: "tool"; args: ToolArgs }
  | { id: number; kind: "sleep"; args: SleepArgs }
  | { id: number; kind: "approval"; args: ApprovalArgs }
  | { id: number; kind: "runAgent"; args: RunAgentArgs }
  | { id: number; kind: "notify"; args: NotifyArgs }
  | { id: number; kind: "now"; args: Record<string, never> }
  | { id: number; kind: "uuid"; args: Record<string, never> }
  | { id: number; kind: "random"; args: Record<string, never> }
  | { id: number; kind: "memory_get"; args: MemoryGetArgs }
  | { id: number; kind: "memory_set"; args: MemorySetArgs }
  | { id: number; kind: "scratch_get"; args: ScratchGetArgs }
  | { id: number; kind: "scratch_set"; args: ScratchSetArgs }
  | { id: number; kind: "waitForRun"; args: WaitForRunArgs };

export type IpcCallKind = IpcCall["kind"];

/** All call_type values, matching the SQL CHECK in 0012_run_events.sql. */
export const IPC_CALL_KINDS = [
  "fork",
  "mcp",
  "tool",
  "sleep",
  "approval",
  "runAgent",
  "notify",
  "now",
  "uuid",
  "random",
  "memory_get",
  "memory_set",
  "scratch_get",
  "scratch_set",
  "waitForRun",
] as const satisfies readonly IpcCallKind[];

// ---------------------------------------------------------------------------
// Response framing.
// ---------------------------------------------------------------------------

export interface IpcErrorBody {
  /** Symbolic error class. `retryable` / `permanent` map to SDK error types. */
  kind: "retryable" | "permanent" | "validation" | "timeout" | "internal";
  message: string;
  /** True iff the runtime should re-queue. */
  retryable: boolean;
  /** Optional structured details (e.g. validation issues). */
  details?: unknown;
}

export type IpcResponse<TResult = unknown> =
  | { id: number; ok: true; result: TResult }
  | { id: number; ok: false; error: IpcErrorBody };

// ---------------------------------------------------------------------------
// Per-kind result types — index by call kind for type-safe dispatch.
// ---------------------------------------------------------------------------

export interface IpcResultMap {
  fork: ForkResult;
  mcp: unknown;
  tool: unknown;
  sleep: void;
  approval: { approved: boolean; reason?: string };
  runAgent: unknown;
  notify: void;
  now: string; // ISO-8601 UTC
  uuid: string;
  random: number; // [0, 1)
  memory_get: unknown;
  memory_set: void;
  scratch_get: unknown;
  scratch_set: void;
  waitForRun: ForkResult;
}

/** Compile-time check: every IpcCall kind must have a result mapping. */
export type _IpcResultCoverage = IpcCallKind extends keyof IpcResultMap ? true : never;
