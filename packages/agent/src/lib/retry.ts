/**
 * Retry-with-jitter + per-process circuit breaker for agent invocations.
 *
 * The agent loop calls into pi-agent-core's runAgentLoop, which streams from
 * the LLM provider. Transient provider failures (529 overload, 502/503/504
 * gateway noise, ECONNRESET mid-stream) are common at scale; without retry
 * they each turn into a hard run failure. This wrapper adds bounded retries
 * with exponential backoff + jitter and a per-process circuit breaker so a
 * downed provider doesn't burn the whole worker pool.
 *
 * **Critical safety constraint** (codex round 1 #2): only retry when the
 * stream errored BEFORE any tool call fired in the current turn. Once a tool
 * has run, side effects may have landed (file writes, MCP mutations,
 * channels) and re-running the turn would double-execute them.
 *
 * The caller passes a `toolsFiredInTurn` predicate the wrapper consults
 * before deciding to retry. The agent loop tracks tool calls per turn via
 * `beforeToolCall`; that counter feeds the predicate.
 */

const DEFAULT_RETRY_STATUSES = new Set([429, 502, 503, 504, 529]);
const DEFAULT_RETRY_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
]);

export interface RetryOptions {
  tries?: number;
  baseMs?: number;
  maxMs?: number;
  jitter?: number;
  retryOnStatus?: ReadonlySet<number>;
  retryOnCode?: ReadonlySet<string>;
  /** Returns true when at least one tool has already fired in this turn. */
  toolsFiredInTurn?: () => boolean;
  /** Hook for telemetry; called once per attempt with the attempt index (0-based) and the prior error. */
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
  /**
   * Optional sleep override (test injection). Defaults to `setTimeout`.
   */
  sleep?: (ms: number) => Promise<void>;
}

export interface CircuitBreakerOptions {
  /** Consecutive same-error fails before opening. */
  threshold?: number;
  /** Open duration in ms. */
  cooldownMs?: number;
  /** Now-fn override (test). */
  now?: () => number;
}

export const DEFAULT_RETRY: Required<Omit<RetryOptions, "toolsFiredInTurn" | "onRetry" | "sleep">> =
  {
    tries: 3,
    baseMs: 500,
    maxMs: 8000,
    jitter: 0.3,
    retryOnStatus: DEFAULT_RETRY_STATUSES,
    retryOnCode: DEFAULT_RETRY_CODES,
  };

export const DEFAULT_BREAKER: Required<CircuitBreakerOptions> = {
  threshold: 3,
  cooldownMs: 60_000,
  now: Date.now,
};

/**
 * Per-process circuit breaker. Trips after `threshold` consecutive errors
 * with the same fingerprint; stays open for `cooldownMs`. While open, calls
 * fast-fail with the original error.
 */
export class CircuitBreaker {
  private readonly opts: Required<CircuitBreakerOptions>;
  private consecutive = 0;
  private lastFingerprint = "";
  private openUntil = 0;
  private lastError: unknown = undefined;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.opts = { ...DEFAULT_BREAKER, ...opts };
  }

  /** Throws if open. Caller invokes BEFORE making the upstream call. */
  guard(): void {
    if (this.opts.now() < this.openUntil) {
      const err = this.lastError ?? new Error("circuit breaker open");
      throw err;
    }
  }

  recordSuccess(): void {
    this.consecutive = 0;
    this.lastFingerprint = "";
    this.lastError = undefined;
  }

  recordFailure(err: unknown): void {
    const fp = errorFingerprint(err);
    if (fp === this.lastFingerprint) {
      this.consecutive++;
    } else {
      this.consecutive = 1;
      this.lastFingerprint = fp;
    }
    this.lastError = err;
    if (this.consecutive >= this.opts.threshold) {
      this.openUntil = this.opts.now() + this.opts.cooldownMs;
    }
  }

  isOpen(): boolean {
    return this.opts.now() < this.openUntil;
  }
}

/**
 * Run `fn`, retrying transient failures up to `opts.tries` times with
 * exponential backoff + jitter. Honors the `toolsFiredInTurn` predicate to
 * avoid double-executing side effects.
 *
 * Returns the resolved value, or throws the last error after retries are
 * exhausted (or after the first non-retryable error, or after a tool fired).
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const tries = opts.tries ?? DEFAULT_RETRY.tries;
  const baseMs = opts.baseMs ?? DEFAULT_RETRY.baseMs;
  const maxMs = opts.maxMs ?? DEFAULT_RETRY.maxMs;
  const jitter = opts.jitter ?? DEFAULT_RETRY.jitter;
  const retryOnStatus = opts.retryOnStatus ?? DEFAULT_RETRY.retryOnStatus;
  const retryOnCode = opts.retryOnCode ?? DEFAULT_RETRY.retryOnCode;
  const sleep = opts.sleep ?? defaultSleep;

  let attempt = 0;
  let lastErr: unknown;
  while (attempt < tries) {
    try {
      const v = await fn();
      return v;
    } catch (err) {
      lastErr = err;
      // Tool already fired? Side effects may have landed. Surface the error.
      if (opts.toolsFiredInTurn?.()) {
        throw err;
      }
      if (!isRetryable(err, retryOnStatus, retryOnCode)) {
        throw err;
      }
      const isLast = attempt === tries - 1;
      if (isLast) {
        throw err;
      }
      const delay = computeBackoff(attempt, baseMs, maxMs, jitter);
      opts.onRetry?.(attempt, err, delay);
      await sleep(delay);
      attempt++;
    }
  }
  throw lastErr;
}

/**
 * Combine `withRetry` with a CircuitBreaker. Caller pre-allocates the
 * breaker once per process (or once per provider) and shares it across
 * retried calls so consecutive failures across calls trip it.
 */
export async function withRetryAndBreaker<T>(
  fn: () => Promise<T>,
  breaker: CircuitBreaker,
  opts: RetryOptions = {},
): Promise<T> {
  breaker.guard();
  try {
    const v = await withRetry(fn, opts);
    breaker.recordSuccess();
    return v;
  } catch (err) {
    breaker.recordFailure(err);
    throw err;
  }
}

function isRetryable(
  err: unknown,
  retryOnStatus: ReadonlySet<number>,
  retryOnCode: ReadonlySet<string>,
): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  if (typeof e.status === "number" && retryOnStatus.has(e.status)) return true;
  if (typeof e.statusCode === "number" && retryOnStatus.has(e.statusCode)) return true;
  if (typeof e.code === "string" && retryOnCode.has(e.code)) return true;
  // Some streams put status in cause; check one level down only.
  const cause = e.cause;
  if (cause && typeof cause === "object") {
    const c = cause as Record<string, unknown>;
    if (typeof c.status === "number" && retryOnStatus.has(c.status)) return true;
    if (typeof c.code === "string" && retryOnCode.has(c.code)) return true;
  }
  // Heuristic message match for providers that don't structure errors well.
  const msg = typeof e.message === "string" ? e.message : "";
  if (/\b(529|503|504|429|overloaded|rate.?limit|timeout|reset)\b/i.test(msg)) {
    return true;
  }
  return false;
}

function computeBackoff(attempt: number, baseMs: number, maxMs: number, jitter: number): number {
  const exp = baseMs * 2 ** attempt;
  const capped = Math.min(exp, maxMs);
  const jitterRange = capped * jitter;
  const offset = (Math.random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(capped + offset));
}

function errorFingerprint(err: unknown): string {
  if (err == null || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  const status = e.status ?? e.statusCode ?? "";
  const code = e.code ?? "";
  const name = (e.constructor as { name?: string } | undefined)?.name ?? "Error";
  return `${name}:${status}:${code}`;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
