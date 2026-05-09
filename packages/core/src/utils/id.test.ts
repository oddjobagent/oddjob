import { describe, expect, test } from "bun:test";

import { _internal, idTimestamp, isId, newId, type IdPrefix } from "./id.ts";

const PREFIXES: IdPrefix[] = ["run", "dep", "stp"];

describe("newId", () => {
  test("matches the documented shape for every prefix", () => {
    for (const p of PREFIXES) {
      const id = newId(p);
      expect(id).toMatch(/^[a-z]{3}_[0-9a-hjkmnp-tv-z]{14}$/);
      expect(id.startsWith(`${p}_`)).toBe(true);
      expect(id.length).toBe(18);
    }
  });

  test("isId() gates by prefix and rejects mismatches", () => {
    const r = newId("run");
    expect(isId("run", r)).toBe(true);
    expect(isId("dep", r)).toBe(false);
    expect(isId("run", "run_short")).toBe(false);
    expect(isId("run", "")).toBe(false);
    expect(isId("run", undefined)).toBe(false);
    expect(isId("run", 42)).toBe(false);
    // Crockford excludes i, l, o, u — body containing 'i' must fail.
    expect(isId("run", "run_iiiiiiiiiiiiii")).toBe(false);
  });

  test("rapid generations sort monotonically by lex order", () => {
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) {
      ids.push(newId("run"));
      // Force ms boundary on most iterations — the random tail still varies
      // within the same ms, but time-bucket ordering must hold across them.
      if (i % 8 === 0) {
        const t = Date.now();
        // Spin briefly to advance Date.now without sleeping.
        while (Date.now() === t) {
          /* tight loop */
        }
      }
    }
    const sorted = [...ids].sort();
    // Adjacent same-ms ids may swap on lex sort because their random tails
    // are independent. Across different ms the ordering must hold.
    const seen = new Map<string, string>();
    for (const id of sorted) {
      const ts = idTimestamp(id)!;
      const bucket = String(ts);
      const prev = seen.get(bucket);
      if (prev) expect(prev <= id).toBe(true);
      seen.set(bucket, id);
    }
    // And the bucket order itself must be increasing.
    const bucketTs = [...seen.keys()].map(Number);
    for (let i = 1; i < bucketTs.length; i++) {
      expect(bucketTs[i]!).toBeGreaterThanOrEqual(bucketTs[i - 1]!);
    }
  });

  test("idTimestamp round-trips within ±1ms", () => {
    const before = Date.now();
    const id = newId("run");
    const after = Date.now();
    const decoded = idTimestamp(id);
    expect(decoded).toBeDefined();
    expect(decoded!).toBeGreaterThanOrEqual(before - 1);
    expect(decoded!).toBeLessThanOrEqual(after + 1);
  });

  test("idTimestamp returns undefined for non-ids", () => {
    expect(idTimestamp("not-an-id")).toBeUndefined();
    expect(idTimestamp("run_tooShort")).toBeUndefined();
    expect(idTimestamp("5307fe10-e9f6-4fb7-b2bc-cb949e80eead")).toBeUndefined();
  });

  test("no collisions across 10K generations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(newId("run"));
    expect(seen.size).toBe(10_000);
  });

  test("alphabet is 32 chars and lowercase a-z 0-9 only", () => {
    expect(_internal.ALPHABET.length).toBe(32);
    expect(/^[0-9a-z]+$/.test(_internal.ALPHABET)).toBe(true);
    expect(_internal.ALPHABET).not.toContain("i");
    expect(_internal.ALPHABET).not.toContain("l");
    expect(_internal.ALPHABET).not.toContain("o");
    expect(_internal.ALPHABET).not.toContain("u");
  });
});
