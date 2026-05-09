// Context — the surface a script-mode `main.ts` sees.
//
// The runtime supplies a concrete `Context<TInputs>` to the function passed
// to `defineRun`. Every method maps 1:1 with an `IpcCall` variant in
// `dispatch-protocol.ts` and is recorded in the `run_events` table for
// replay (B2.4).
//
// Concurrent ctx calls are forbidden (codex round-1 #3). The dispatcher
// runs one call at a time; `Promise.all([ctx.fork(...), ctx.fork(...)])`
// throws synchronously from the second fork.
//
// Recorded helpers — `ctx.now()` / `ctx.uuid()` / `ctx.random()` — are
// logged so replay reproduces the same values. User code MUST NOT call
// `Date.now()` / `crypto.randomUUID()` / `Math.random()` directly; those
// break replay determinism.

import type { PermanentError, RetryableError } from "./errors.ts";

// ---------------------------------------------------------------------------
// Per-method options.
// ---------------------------------------------------------------------------

export interface ForkOptions {
  /** Sync-only in v1 — `wait: "async"` reserved for Phase C. */
  wait?: "sync";
  /** Per-fork timeout (ms). Falls back to deployment policy. */
  timeoutMs?: number;
}

export interface MemoryOptions {
  /** Soft TTL (ms). The runtime may evict the entry after expiry. */
  ttlMs?: number;
}

export interface ApprovalOptions {
  /** Channel slug for the approval request (slack/email/console/...). Defaults to blueprint config. */
  channel?: string;
  /** Per-approval timeout (ms). Default = no timeout (wait forever or until terminal failure). */
  timeoutMs?: number;
}

export interface ApprovalResult {
  /** Resolution: true when an approver clicked allow / typed `oddjob approve`; false on deny / timeout. */
  approved: boolean;
  /** Free-form reason supplied by the approver (or `"timeout"` when timeoutMs fired). */
  reason?: string;
  /** Identity of the resolver (Slack user, CLI invocation, API caller). Best-effort populated by the resolution path. */
  resolver?: string;
}

export interface RunAgentOptions {
  /** Free-form agent prompt. */
  prompt: string;
  /** Optional system-prompt override; falls back to blueprint composition. */
  systemPrompt?: string;
  /** Tools the sub-agent may call. Falls back to blueprint allowlist. */
  tools?: string[];
  /** Output JSON-Schema. Validated before return. */
  outputSchema?: Record<string, unknown>;
  /** Model role ("default" / "advisor" / custom). */
  role?: string;
  /** Max iterations. Falls back to engine policy. */
  maxIterations?: number;
}

// ---------------------------------------------------------------------------
// Sub-namespaces (memory + scratch + mcp).
// ---------------------------------------------------------------------------

export interface McpHandle {
  /** Call `tool` on this server with `args`. */
  call<TResult = unknown>(tool: string, args: unknown): Promise<TResult>;
}

export interface MemoryNamespace {
  /** Persistent, deployment-scoped. Children do NOT inherit. */
  set<T = unknown>(key: string, value: T, opts?: MemoryOptions): Promise<void>;
  get<T = unknown>(key: string, schema?: Record<string, unknown>): Promise<T | undefined>;
}

export interface ScratchNamespace {
  /** Parent-run-scoped. Siblings share. Cleared at parent terminal status. */
  set<T = unknown>(key: string, value: T): Promise<void>;
  get<T = unknown>(key: string): Promise<T | undefined>;
}

// ---------------------------------------------------------------------------
// Context interface.
//
// `TInputs` is the parsed-and-validated shape of `inputs` for the running
// blueprint. Authors pin it via `defineRun<TInputs, TOutput>(...)` and the
// runtime narrows from `unknown` after Ajv validates against the blueprint
// inputSchema. Default to `unknown` so unparameterized usage stays sound.
// ---------------------------------------------------------------------------

export interface Context<TInputs = unknown> {
  /** Validated blueprint inputs. */
  readonly inputs: TInputs;

  /** Cumulative cost across this run + every descendant fork. Read-only. */
  readonly totalCostUsd: number;

  /** Re-exported error constructors so script authors don't need separate imports. */
  readonly RetryableError: typeof RetryableError;
  readonly PermanentError: typeof PermanentError;

  /** Persistent deployment-scoped memory. Children do NOT inherit. */
  readonly memory: MemoryNamespace;
  /** Parent-run-scoped scratch. Siblings see each other; cleared on parent terminal status. */
  readonly scratch: ScratchNamespace;

  /** Run a child blueprint. Cost rolls up; v1 is sync-only. */
  fork<TIn = unknown, TOut = unknown>(
    blueprintRef: string,
    inputs: TIn,
    opts?: ForkOptions,
  ): Promise<TOut>;

  /** Bind to an MCP server declared in the blueprint connectors map. */
  mcp(server: string): McpHandle;

  /** Call any tool the blueprint has opted into (internal or plugin). */
  tool<TResult = unknown>(name: string, args: unknown): Promise<TResult>;

  /** Recorded sleep — replay returns immediately. */
  sleep(ms: number): Promise<void>;

  /** Inline agent loop. Returns the validated output. */
  runAgent<TResult = unknown>(opts: RunAgentOptions): Promise<TResult>;

  /**
   * Pause the run; route an approval prompt through `[channels].on_approval_needed`
   * channels; resume on resolution. Resolution paths in v1:
   *   - CLI: `oddjob approve <run-id> [--reason "..."]` / `oddjob deny <run-id>`
   *   - API: `POST /api/v1/runs/:id/approval`
   *   - Channels: any [channels] entry receives a notification with the run id
   *
   * If `timeoutMs` fires, returns `{approved: false, reason: "timeout"}`.
   * Recorded in `run_events` so replay returns the recorded resolution.
   */
  requestApproval(prompt: string, opts?: ApprovalOptions): Promise<ApprovalResult>;

  /** Send a message via a configured channel. */
  notify(channel: string, message: unknown): Promise<void>;

  /**
   * Recorded helper. DO NOT call `Date.now()` or `new Date()` directly —
   * breaks replay. Async because the runtime persists the recorded value
   * to `run_events`; replay returns the recorded ISO string without
   * issuing a fresh Date. (codex round-12 #3)
   */
  now(): Promise<Date>;

  /** Recorded helper. DO NOT call `crypto.randomUUID()` directly — breaks replay. */
  uuid(): Promise<string>;

  /** Recorded helper. DO NOT call `Math.random()` directly — breaks replay. */
  random(): Promise<number>;
}

// ---------------------------------------------------------------------------
// Concurrent-call guard.
//
// B2.3 wires a real dispatcher that increments / decrements an in-flight
// counter around each ctx.* call. This helper is a tiny standalone shim that
// the dispatcher can instantiate and that lives in @oddjob/sdk so it stays
// reachable from non-runtime contexts (local-debug, mock contexts in tests).
// ---------------------------------------------------------------------------

export interface SerialDispatcher {
  /** Throws if another call is in flight. */
  begin(callSite: string): void;
  /** Marks the in-flight call complete. */
  end(): void;
}

/**
 * Allocate a single-slot dispatcher guard. The runtime calls `begin` before
 * dispatching an `IpcCall` and `end` once the response (success or error)
 * has resolved. The error message is part of the SDK contract — Python /
 * Go ports surface the same text.
 */
export function assertSerial(): SerialDispatcher {
  let inflight: string | null = null;
  return {
    begin(callSite: string): void {
      if (inflight !== null) {
        throw new Error(
          `concurrent ctx.* calls are forbidden — ${inflight} is in flight; ` +
            `attempted to dispatch ${callSite}. ` +
            `wrap parallel work in ctx.fork(...) instead of Promise.all.`,
        );
      }
      inflight = callSite;
    },
    end(): void {
      inflight = null;
    },
  };
}
