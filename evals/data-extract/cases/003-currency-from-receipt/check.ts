// Programmatic verifier for evals/data-extract/003-currency-from-receipt.
// argv[2] = sandboxDir; harness writes agent's structured output to
// <sandboxDir>/.eval-output.json. expected.json lives next to this file.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sandboxDir = process.argv[2];
if (!sandboxDir) {
  console.error("usage: bun check.ts <sandboxDir>");
  process.exit(2);
}

const here = resolve(fileURLToPath(import.meta.url), "..");
const outPath = resolve(sandboxDir, ".eval-output.json");
const expectedPath = resolve(here, "expected.json");

interface Tx {
  label: string;
  amount_usd: number;
}

interface Shape {
  transactions: Tx[];
}

const isShape = (v: unknown): v is Shape => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r.transactions)) return false;
  return r.transactions.every((t: unknown) => {
    if (typeof t !== "object" || t === null) return false;
    const tt = t as Record<string, unknown>;
    return typeof tt.label === "string" && typeof tt.amount_usd === "number";
  });
};

const got = await Bun.file(outPath).json().catch(() => null);
if (got === null) {
  console.error("FAIL: agent did not produce a structured output (.eval-output.json missing)");
  process.exit(1);
}
const want = (await Bun.file(expectedPath).json()) as Shape;
if (!isShape(got)) {
  console.error("FAIL: output does not match {transactions: [{label, amount_usd}]}");
  console.error("got:", JSON.stringify(got));
  process.exit(1);
}

// Compare set-equally on (normalized label, amount). Order doesn't matter
// but both sides must contain the same set.
const norm = (t: Tx): string => `${t.label.trim().toLowerCase()}|${t.amount_usd}`;
const gotSet = new Set(got.transactions.map(norm));
const wantSet = new Set(want.transactions.map(norm));
const missing = [...wantSet].filter((k) => !gotSet.has(k));
const extra = [...gotSet].filter((k) => !wantSet.has(k));
if (missing.length === 0 && extra.length === 0) {
  console.log(`PASS: ${gotSet.size} transactions match`);
  process.exit(0);
}
console.error(`FAIL: missing=${missing.join(",") || "—"}; extra=${extra.join(",") || "—"}`);
process.exit(1);
