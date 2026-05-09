// Errors thrown from script-mode `main.ts` runs.
//
// `RetryableError` signals a transient failure — the runtime re-queues the
// run with backoff. `PermanentError` is a hard-fail — no retry, status moves
// straight to `error`. Both are plain `Error` subclasses so `instanceof Error`
// is true in user code.
//
// These are exposed on `Context` as `ctx.RetryableError` / `ctx.PermanentError`
// so script authors don't need a separate import.

export interface RetryableErrorOptions {
  /** Max retry attempts. Falls back to blueprint outcomes.maxRetries. */
  max?: number;
  /** Initial backoff (ms). Subsequent retries double per blueprint policy. */
  backoffMs?: number;
}

export class RetryableError extends Error {
  readonly kind = "retryable" as const;
  readonly max?: number;
  readonly backoffMs?: number;
  constructor(message: string, opts: RetryableErrorOptions = {}) {
    super(message);
    this.name = "RetryableError";
    this.max = opts.max;
    this.backoffMs = opts.backoffMs;
  }
}

export class PermanentError extends Error {
  readonly kind = "permanent" as const;
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}
