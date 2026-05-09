// Programmatic verifier for evals/data-extract/002-dates-from-text.
//   argv[2] = sandboxDir; eval harness writes agent's structured output
//             to <sandboxDir>/.eval-output.json.
// expected.json lives next to this file.

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

interface DatesShape {
  dates: string[];
}

const isShape = (v: unknown): v is DatesShape => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r.dates)) return false;
  return r.dates.every((d) => typeof d === "string");
};

const actualRaw = await Bun.file(outPath).json().catch(() => null);
if (actualRaw === null) {
  console.error("FAIL: agent did not produce a structured output (.eval-output.json missing)");
  process.exit(1);
}
const expectedRaw = (await Bun.file(expectedPath).json()) as unknown;

if (!isShape(actualRaw)) {
  console.error("FAIL: actual output does not match {dates: string[]} schema");
  process.exit(1);
}
if (!isShape(expectedRaw)) {
  console.error("FAIL: expected.json malformed");
  process.exit(2);
}

const isoRe = /^\d{4}-\d{2}-\d{2}$/;
const bad = actualRaw.dates.filter((d) => !isoRe.test(d));
if (bad.length > 0) {
  console.error(`FAIL: non-ISO dates in output: ${bad.join(", ")}`);
  process.exit(1);
}

const a = new Set(actualRaw.dates);
const e = new Set(expectedRaw.dates);
const missing = [...e].filter((d) => !a.has(d));
const extra = [...a].filter((d) => !e.has(d));

if (missing.length === 0 && extra.length === 0) {
  console.log(`PASS: ${a.size} dates match`);
  process.exit(0);
}
console.error(`FAIL: missing=${missing.join(",") || "—"}; extra=${extra.join(",") || "—"}`);
process.exit(1);
