// Project-wide id generator. Stripe-style typed prefix + 14-char body in
// Crockford base32 lowercase. Time-seeded (lex-sortable = chronological for
// rows with the same prefix) and URL-safe.
//
// Layout: <prefix>_<8 time chars><6 random chars>
//   - time: ms since EPOCH_MS, 40 bits → 8 chars × 5 bits.
//           ~35-year window from the project epoch (2026-01-01 UTC).
//   - random: 30 bits → 6 chars × 5 bits.
//             Birthday-safe at ~32K writes per millisecond — far above any
//             realistic single-process or single-region throughput.
//
// Sorting: Crockford alphabet "0123456789abcdefghjkmnpqrstvwxyz" is monotonic
// in ASCII order (digits < letters; the omitted i/l/o/u preserve order). So
// `ORDER BY id` on rows with the same prefix yields creation order without a
// separate timestamp column.

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const EPOCH_MS = Date.UTC(2026, 0, 1);
const TIME_CHARS = 8;
const RAND_CHARS = 6;

// Environments are user-chosen names ("default", "prod"), not generated; they
// don't appear here. Add new prefixes only when a new entity needs minted ids.
export type IdPrefix = "run" | "dep" | "stp";

const ID_PATTERN: Record<IdPrefix, RegExp> = {
  run: /^run_[0-9a-hjkmnp-tv-z]{14}$/,
  dep: /^dep_[0-9a-hjkmnp-tv-z]{14}$/,
  stp: /^stp_[0-9a-hjkmnp-tv-z]{14}$/,
};

function encodeBase32(value: bigint, chars: number): string {
  let out = "";
  let v = value;
  for (let i = 0; i < chars; i++) {
    const idx = Number(v & 31n);
    out = ALPHABET[idx]! + out;
    v >>= 5n;
  }
  return out;
}

function decodeBase32(s: string): bigint {
  let v = 0n;
  for (const c of s) {
    const idx = ALPHABET.indexOf(c);
    if (idx < 0) return -1n;
    v = (v << 5n) | BigInt(idx);
  }
  return v;
}

/**
 * Mint a fresh id for the given entity prefix.
 * Always 18 chars: 3-char prefix + underscore + 14-char body.
 */
export function newId(prefix: IdPrefix): string {
  const tMs = Date.now() - EPOCH_MS;
  const time = encodeBase32(BigInt(tMs), TIME_CHARS);
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  // 30 bits = top 30 of the 32 we read.
  const rand =
    ((BigInt(buf[0]!) << 24n) |
      (BigInt(buf[1]!) << 16n) |
      (BigInt(buf[2]!) << 8n) |
      BigInt(buf[3]!)) >>
    2n;
  const random = encodeBase32(rand, RAND_CHARS);
  return `${prefix}_${time}${random}`;
}

/** Cheap shape check. Doesn't decode — just regex on prefix + body class. */
export function isId(prefix: IdPrefix, value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN[prefix].test(value);
}

/**
 * Decode the timestamp portion back to epoch ms. Returns undefined for ids that
 * don't match any known prefix (UUIDs, blueprint refs, foo_<14>, etc).
 */
export function idTimestamp(id: string): number | undefined {
  const u = id.indexOf("_");
  if (u < 0) return undefined;
  const prefix = id.slice(0, u);
  if (!(prefix in ID_PATTERN)) return undefined;
  if (!ID_PATTERN[prefix as IdPrefix].test(id)) return undefined;
  const time = id.slice(u + 1, u + 1 + TIME_CHARS);
  const v = decodeBase32(time);
  if (v < 0n) return undefined;
  return Number(v) + EPOCH_MS;
}

/** Re-exported for tests / debugging only — don't use in production code. */
export const _internal = { ALPHABET, EPOCH_MS, TIME_CHARS, RAND_CHARS };
