// Programmatic verifier for evals/data-extract/007-table-rows-from-csv.
// Compares each row deeply (order-sensitive — CSV preserves source order).

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

type Row = Record<string, string>;
interface Shape {
  rows: Row[];
}
const isRow = (v: unknown): v is Row => {
  if (typeof v !== "object" || v === null) return false;
  return Object.values(v).every((x) => typeof x === "string");
};
const isShape = (v: unknown): v is Shape => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return Array.isArray(r.rows) && r.rows.every(isRow);
};

const got = (await Bun.file(outPath).json().catch(() => null)) as unknown;
if (got === null) {
  console.error("FAIL: agent did not produce a structured output (.eval-output.json missing)");
  process.exit(1);
}
if (!isShape(got)) {
  console.error("FAIL: output does not match {rows: [{<col>: string}]}");
  process.exit(1);
}
const want = (await Bun.file(expectedPath).json()) as Shape;

if (got.rows.length !== want.rows.length) {
  console.error(`FAIL: row count mismatch — got ${got.rows.length}, expected ${want.rows.length}`);
  process.exit(1);
}

const norm = (r: Row): Row => {
  const out: Row = {};
  for (const k of Object.keys(r).sort()) out[k] = r[k]!.trim();
  return out;
};

for (let i = 0; i < want.rows.length; i++) {
  const a = JSON.stringify(norm(got.rows[i]!));
  const e = JSON.stringify(norm(want.rows[i]!));
  if (a !== e) {
    console.error(`FAIL: row ${i} mismatch`);
    console.error(`  got:      ${a}`);
    console.error(`  expected: ${e}`);
    process.exit(1);
  }
}
console.log(`PASS: ${got.rows.length} rows match`);
process.exit(0);
