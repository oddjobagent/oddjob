// Token-shape redaction shared between the egress proxy log lines and any
// other persistence path that may capture agent-supplied or tool-derived
// strings (run_logs meta_json, tool args, web_fetch finalUrl, etc.). Keeping
// the patterns in one module ensures additions (new vendor token shapes) take
// effect everywhere at once.

const REDACT_PATTERNS: readonly RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\b(?:xoxb|xoxp|xapp|xwfp)-[A-Za-z0-9-]{20,}\b/g,
  /\bdtn_[a-f0-9]{40,}\b/g,
];

/** Replace any token-shape match with `[REDACTED]`. */
export function redactString(s: string): string {
  let out = s;
  for (const re of REDACT_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

/**
 * Recursively walk a value and replace token-shape matches inside any string
 * leaf with `[REDACTED]`. Objects and arrays are reconstructed; primitives
 * other than string are returned unchanged. Function-valued props are
 * dropped (so a custom `toJSON()` can't smuggle a token into a later
 * `JSON.stringify`). Cycles are broken with a WeakSet — a cycle's repeat
 * encounter resolves to the placeholder string `"[CYCLIC]"` rather than
 * recursing.
 *
 * NOTE: this is the source-side scrubber. For storage paths, prefer
 * `redactStringified` — it serializes BEFORE scrubbing, which catches
 * whatever shape the JSON actually emits (including post-toJSON output).
 */
export function deepRedact<T>(value: T): T {
  return walk(value, new WeakSet<object>()) as T;
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value);
  if (typeof value === "function") return undefined;
  // BigInt isn't JSON-serializable. Convert to a string with an explicit
  // "n" suffix so it's lossless + visually distinguishable from a plain
  // number when reading the persisted log. Without this, a `meta = { n: 1n }`
  // would later crash `JSON.stringify` and bring the Run's log write down.
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[CYCLIC]";
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => walk(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "function") continue;
    out[k] = walk(v, seen);
  }
  return out;
}

/**
 * Serialize THEN scrub. Used at the storage boundary so a value with a
 * custom `toJSON()` can't smuggle a vendor token past `deepRedact`. Returns
 * `null` when the input itself is nullish, so callers can pass it straight
 * through to a NULLable column.
 */
export function redactStringified(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    // Cycles / non-serializable — fall back to deepRedact + stringify.
    serialized = JSON.stringify(deepRedact(value));
  }
  if (serialized === undefined) return null;
  return redactString(serialized);
}
