import type { Provider } from "./base.ts";

/**
 * Durable run-event log for `ctx.*` calls in script-mode blueprints (B2.3/B2.4).
 *
 * Every dispatched ctx call writes a `pending` row keyed by (runId, seq) BEFORE
 * the side effect, then updates to `completed`/`failed` after. Replay reads the
 * log: `completed` rows return the recorded result; `pending` rows re-execute
 * (at-least-once); a hash mismatch on the (callSite, callType, callArgsHash)
 * triple throws "call drift" so we fail loud rather than producing an
 * inconsistent run.
 *
 * Schema-versioned per migration `0012_run_events.sql`.
 */
export interface RunEventRecord {
  runId: string;
  /** Strict per-run cursor; primary key with runId. */
  seq: number;
  /** Source pointer for diagnostics — function name, file:line, or ctx label. */
  callSite: string;
  /** Discriminator matching `IpcCall["kind"]`. */
  callType: string;
  /** sha256(canonicalJsonStringify(args)). */
  callArgsHash: string;
  /** Canonical-JSON args. May be omitted for very large payloads. */
  argsJson?: string;
  status: "pending" | "completed" | "failed";
  startedAt: number;
  completedAt?: number;
  /** Canonical-JSON result. Truncated to a fixed cap by the recorder. */
  resultJson?: string;
  /** Canonical-JSON error body. Shape mirrors `IpcErrorBody`. */
  errorJson?: string;
  /** Set when callType === "fork". */
  childRunId?: string;
  schemaVersion: 1;
}

/** Patch applied by `update` after the side effect resolves. */
export interface RunEventPatch {
  status: "completed" | "failed";
  completedAt: number;
  resultJson?: string;
  errorJson?: string;
  childRunId?: string;
}

export interface RunEventProvider extends Provider {
  /** Insert a pending row. Honours the (runId, seq) primary key. */
  record(record: RunEventRecord): Promise<void>;
  /** Update an existing row to completed/failed. */
  update(runId: string, seq: number, patch: RunEventPatch): Promise<void>;
  /** Next free seq for a given run. 0 for empty. */
  getNextSeq(runId: string): Promise<number>;
  /** Lookup a single row by composite key. Returns null if absent. */
  findByKey(runId: string, seq: number): Promise<RunEventRecord | null>;
  /** Read every row for a run, ordered by seq ascending. */
  list(runId: string): Promise<RunEventRecord[]>;
}
