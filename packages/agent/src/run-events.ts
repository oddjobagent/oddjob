// Replay/record orchestrator for `ctx.*` calls in script-mode (B2.4).
//
// Every call gets a (runId, seq) row in `run_events`:
//   1. Allocate next seq + canonical-hash the args.
//   2. Look up an existing row at (runId, seq):
//        - completed AND callSite/callType/callArgsHash match -> return recorded result.
//        - completed AND mismatch -> THROW (call drift; fail loud per codex round-6 #3).
//        - failed -> re-throw the recorded error (don't silently retry).
//        - pending -> at-least-once: re-execute (we don't know if the side
//          effect succeeded; the recorded args + site already match).
//   3. Insert pending row, run fn(), update to completed/failed with result.
//
// Replay determinism contract: callers MUST drive seq monotonically AND in
// the same order across replays. The dispatcher + serial guard upstream
// guarantee that — concurrent ctx.* calls are forbidden.

import { createHash } from "node:crypto";

import type { RunEventProvider, RunEventRecord } from "@oddjob/core";

import { canonicalJsonStringify } from "./lib/canonical-json.ts";

/**
 * Result-payload cap for what we persist in `result_json`. 64 KB —
 * generous enough that ctx.fork (which returns the child's structured
 * output) and ctx.tool (whose 8 KB truncation already applied) both fit
 * comfortably. (codex round-16 #1: the original 4 KB cap silently
 * corrupted replay for any result > 4 KB.)
 *
 * On overflow, replay throws loudly via `assertNoDrift` rather than
 * returning a truncation sentinel — better to fail loud than to mask a
 * non-deterministic replay.
 */
const RESULT_JSON_CAP = 64 * 1024;
/** Args-payload cap for `args_json`. 4 KB. Larger args persist as null. */
const ARGS_JSON_CAP = 4 * 1024;
/** Sentinel marker stored when a result exceeds RESULT_JSON_CAP. */
const TRUNCATED_MARKER = "__oddjob_run_event_truncated__";

export interface WithRunEventOptions {
  runId: string;
  /** Source pointer for diagnostics — function name or ctx label. */
  callSite: string;
  /** Discriminator matching `IpcCall["kind"]`. */
  callType: string;
  /** Arguments — canonical-JSON serialized + sha256-hashed for drift detection. */
  args: unknown;
  /** Optional: child run id (set by ctx.fork once it allocates the child). */
  onChildRunId?: () => string | undefined;
  /**
   * Pre-allocated seq for THIS call (codex round-12 #1). The runtime
   * maintains a per-run cursor that starts at 0 and increments in call
   * order; replay reuses the same sequence so existing rows are found.
   * Without this, getNextSeq returns MAX+1 — which on replay skips every
   * persisted row and re-executes side effects.
   */
  seq: number;
}

/**
 * Per-run cursor allocator. The runtime constructs one per script-mode
 * run; every ctx.* dispatch calls `next()` to claim its seq. Recording
 * and replay share the same allocator → same sequence → existing rows
 * line up.
 */
export interface SeqCursor {
  next(): number;
  /** Current value — the next seq that `next()` will return. */
  peek(): number;
}

export function makeSeqCursor(start = 0): SeqCursor {
  let cursor = start;
  return {
    next() {
      return cursor++;
    },
    peek() {
      return cursor;
    },
  };
}

export interface ReplayDriftError extends Error {
  kind: "replay_drift";
  field: "callSite" | "callType" | "callArgsHash";
  recorded: string;
  attempted: string;
}

/**
 * Compute the sha256(canonicalJson(args)) hash used to detect call drift on
 * replay. Exposed so tests can assert hash stability across key orderings.
 */
export function hashCallArgs(args: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(args)).digest("hex");
}

/**
 * Wrap a side-effecting `ctx.*` call with record/replay semantics. Returns the
 * value `fn()` produced (live) OR the previously-recorded value (replay). The
 * runtime hands `result.json` back as JSON so non-string results survive
 * round-trips through the row.
 *
 * `provider` may be undefined; in that case the wrapper acts as a pass-through
 * (the call runs every time and nothing is recorded). Tests use this for
 * non-durable runs.
 */
export async function withRunEvent<T>(
  provider: RunEventProvider | undefined,
  opts: WithRunEventOptions,
  fn: () => Promise<T>,
): Promise<T> {
  if (!provider) return fn();

  // Use the caller-supplied seq (allocated from a per-run cursor).
  // DO NOT use provider.getNextSeq — that returns MAX+1 which on replay
  // would skip every existing row. (codex round-12 #1)
  const seq = opts.seq;
  const argsCanon = canonicalJsonStringify(opts.args);
  const callArgsHash = createHash("sha256").update(argsCanon).digest("hex");

  // Replay path: an existing row was already written at this seq.
  const existing = await provider.findByKey(opts.runId, seq);
  if (existing) {
    assertNoDrift(existing, opts, callArgsHash);
    if (existing.status === "completed") {
      return existing.resultJson === undefined
        ? (undefined as T)
        : (parseRecordedResult(existing) as T);
    }
    if (existing.status === "failed") {
      throw rehydrateError(existing.errorJson);
    }
    // status === "pending": at-least-once re-execute. Fall through and run
    // fn() again; we'll overwrite the patched fields on completion.
  } else {
    const startedAt = Date.now();
    const record: RunEventRecord = {
      runId: opts.runId,
      seq,
      callSite: opts.callSite,
      callType: opts.callType,
      callArgsHash,
      argsJson: argsCanon.length <= ARGS_JSON_CAP ? argsCanon : undefined,
      status: "pending",
      startedAt,
      schemaVersion: 1,
    };
    await provider.record(record);
  }

  try {
    const result = await fn();
    let resultJson: string | undefined;
    try {
      const canon = canonicalJsonStringify(result);
      resultJson = canon.length <= RESULT_JSON_CAP ? canon : truncateJson(canon);
    } catch {
      resultJson = undefined;
    }
    const childRunId = opts.onChildRunId?.();
    await provider.update(opts.runId, seq, {
      status: "completed",
      completedAt: Date.now(),
      resultJson,
      childRunId,
    });
    return result;
  } catch (err) {
    const errorJson = canonicalJsonStringify(serializeError(err));
    await provider.update(opts.runId, seq, {
      status: "failed",
      completedAt: Date.now(),
      errorJson,
    });
    throw err;
  }
}

function assertNoDrift(
  recorded: RunEventRecord,
  attempted: WithRunEventOptions,
  attemptedHash: string,
): void {
  const checks: Array<{ field: ReplayDriftError["field"]; recorded: string; attempted: string }> = [
    { field: "callType", recorded: recorded.callType, attempted: attempted.callType },
    { field: "callSite", recorded: recorded.callSite, attempted: attempted.callSite },
    { field: "callArgsHash", recorded: recorded.callArgsHash, attempted: attemptedHash },
  ];
  for (const c of checks) {
    if (c.recorded !== c.attempted) {
      const e = new Error(
        `replay drift at run ${recorded.runId} seq ${recorded.seq}: ` +
          `${c.field} mismatch (recorded=${c.recorded}, attempted=${c.attempted})`,
      ) as ReplayDriftError;
      e.kind = "replay_drift";
      e.field = c.field;
      e.recorded = c.recorded;
      e.attempted = c.attempted;
      throw e;
    }
  }
}

function serializeError(err: unknown): {
  name: string;
  message: string;
  kind?: string;
  stack?: string;
} {
  if (err instanceof Error) {
    const out: { name: string; message: string; kind?: string; stack?: string } = {
      name: err.name,
      message: err.message,
    };
    const k = (err as { kind?: unknown }).kind;
    if (typeof k === "string") out.kind = k;
    if (err.stack) out.stack = err.stack;
    return out;
  }
  return { name: "NonError", message: String(err) };
}

function rehydrateError(errorJson: string | undefined): Error {
  if (!errorJson) return new Error("recorded run_event failed (no error body)");
  try {
    const parsed = JSON.parse(errorJson) as {
      name?: string;
      message?: string;
      kind?: string;
      stack?: string;
    };
    const e = new Error(parsed.message ?? "recorded run_event failed") as Error & {
      kind?: string;
    };
    if (parsed.name) e.name = parsed.name;
    // Preserve `kind` so RetryableError / PermanentError classification
    // survives replay. (codex round-12 #5) The retry layer reads this
    // discriminator to decide whether to reschedule.
    if (parsed.kind) e.kind = parsed.kind;
    // Preserve the original stack as a separate property so consumers can
    // still see where the failure originated. We don't override the live
    // stack — that points to the rehydration site, useful for debugging
    // the replay path itself.
    if (parsed.stack) {
      Object.defineProperty(e, "originalStack", {
        value: parsed.stack,
        enumerable: false,
        writable: false,
      });
    }
    return e;
  } catch {
    return new Error(`recorded run_event failed: ${errorJson}`);
  }
}

function truncateJson(canon: string): string {
  // Sentinel envelope. The replay path detects this marker and THROWS
  // rather than silently returning a partial result — a recorded run
  // whose result was too large for durable storage cannot be replayed
  // deterministically; the caller must re-record. (codex round-16 #1)
  return JSON.stringify({
    [TRUNCATED_MARKER]: true,
    bytes: canon.length,
    cap: RESULT_JSON_CAP,
    head: canon.slice(0, RESULT_JSON_CAP - 256),
  });
}

/**
 * Detect the truncation sentinel in a JSON-parsed result. Returns the
 * original size in bytes when the sentinel is present, otherwise
 * undefined. Replay throws loud when this returns a value.
 */
function isTruncatedSentinel(parsed: unknown): { bytes: number; cap: number } | undefined {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const r = parsed as Record<string, unknown>;
    if (r[TRUNCATED_MARKER] === true && typeof r.bytes === "number" && typeof r.cap === "number") {
      return { bytes: r.bytes, cap: r.cap };
    }
  }
  return undefined;
}

/**
 * Parse a recorded run_event result, throwing loudly if the persisted
 * payload was truncated. Truncation means the original ctx.* result
 * exceeded RESULT_JSON_CAP and we cannot reconstruct it deterministically
 * — re-execution is the only safe option, but replay implies the side
 * effect already fired, so we surface this as a non-recoverable replay
 * error rather than silently returning the sentinel envelope. (codex
 * round-16 #1)
 */
function parseRecordedResult(rec: RunEventRecord): unknown {
  const parsed = JSON.parse(rec.resultJson ?? "null") as unknown;
  const t = isTruncatedSentinel(parsed);
  if (t) {
    throw new Error(
      `cannot replay run ${rec.runId} seq ${rec.seq} (${rec.callType} @ ${rec.callSite}): ` +
        `recorded result was truncated (${t.bytes} bytes > ${t.cap} cap). ` +
        `Re-record this run; replay would silently corrupt state.`,
    );
  }
  return parsed;
}

export { canonicalJsonStringify };
export type { RunEventProvider, RunEventRecord };
