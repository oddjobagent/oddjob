// Programmatic verifier for evals/data-extract/005-semver-from-changelog.
// Compares as a set (order-insensitive). Versions are case-sensitive
// strings, normalized by trim only.

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

interface Shape {
  versions: string[];
}
const isShape = (v: unknown): v is Shape => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return Array.isArray(r.versions) && r.versions.every((x) => typeof x === "string");
};

const got = (await Bun.file(outPath).json().catch(() => null)) as unknown;
if (got === null) {
  console.error("FAIL: agent did not produce a structured output (.eval-output.json missing)");
  process.exit(1);
}
if (!isShape(got)) {
  console.error("FAIL: output does not match {versions: string[]}");
  process.exit(1);
}
const want = (await Bun.file(expectedPath).json()) as Shape;

const norm = (s: string) => s.trim();
const a = new Set(got.versions.map(norm));
const e = new Set(want.versions.map(norm));
const missing = [...e].filter((v) => !a.has(v));
const extra = [...a].filter((v) => !e.has(v));
if (missing.length > 0 || extra.length > 0) {
  console.error("FAIL: version set mismatch");
  if (missing.length > 0) console.error("  missing:", missing);
  if (extra.length > 0) console.error("  extra:", extra);
  process.exit(1);
}
console.log(`PASS: ${a.size} versions match`);
process.exit(0);
