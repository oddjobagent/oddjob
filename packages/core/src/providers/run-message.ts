import type { Provider } from "./base.ts";

/**
 * Persistent run-message log. Used to capture the pre-compaction history
 * that compaction (B1.3) replaces with a synthetic `<compacted>` summary.
 * Without this, a compacted run loses the original transcript segment from
 * durable state — replay/debug can't recover what was collapsed.
 *
 * The replay engine (B2.4) will also persist `ctx.*` recorded messages
 * here. Schema-versioned per migration 0013_run_messages.sql.
 */
export interface MessageRecord {
  runId: string;
  /** Strict per-run cursor; primary key with runId. */
  seq: number;
  /** "user" | "assistant" | "tool" | "compacted". Free-form on the wire. */
  role: string;
  /** Canonical JSON payload of the message (content blocks etc.). */
  content: unknown;
  /** Wall-clock ms when the message was recorded. */
  recordedAt: number;
}

export interface MessageQuery {
  /** Inclusive lower bound on seq. */
  sinceSeq?: number;
  /** Max rows to return. */
  limit?: number;
  /** Filter by role. */
  role?: string;
}

export interface MessageProvider extends Provider {
  /**
   * Record a message. Implementations MUST honour the `(run_id, seq)`
   * primary key — duplicate inserts are rejected so replay determinism
   * is preserved.
   */
  recordMessage(record: MessageRecord): Promise<void>;
  /** Read messages back, ordered by seq ascending. */
  getMessages(runId: string, options?: MessageQuery): Promise<MessageRecord[]>;
  /**
   * Returns the next free seq for a given run. Optional helper for callers
   * that want to append without tracking the cursor themselves.
   */
  nextSeq(runId: string): Promise<number>;
}
