// Programmatic verifier for evals/data-extract/004-citations-from-paper.
// Compares actual vs expected as a multiset of {authors, year, title}.

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

interface Cite {
  authors: string[];
  year: number;
  title: string;
}
interface Shape {
  citations: Cite[];
}

const isCite = (v: unknown): v is Cite => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    Array.isArray(r.authors) &&
    r.authors.every((a) => typeof a === "string") &&
    typeof r.year === "number" &&
    typeof r.title === "string"
  );
};
const isShape = (v: unknown): v is Shape => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return Array.isArray(r.citations) && r.citations.every(isCite);
};

const got = (await Bun.file(outPath).json().catch(() => null)) as unknown;
if (got === null) {
  console.error("FAIL: agent did not produce a structured output (.eval-output.json missing)");
  process.exit(1);
}
if (!isShape(got)) {
  console.error("FAIL: output does not match {citations: [{authors,year,title}]}");
  console.error("got:", JSON.stringify(got).slice(0, 500));
  process.exit(1);
}
const want = (await Bun.file(expectedPath).json()) as Shape;

const norm = (c: Cite) => {
  const authors = [...c.authors]
    .map((a) => a.trim().toLowerCase())
    .sort()
    .join("|");
  const title = c.title.trim().toLowerCase().replace(/\s+/g, " ");
  return `${authors}::${c.year}::${title}`;
};

const gotKeys = new Map<string, number>();
for (const c of got.citations) gotKeys.set(norm(c), (gotKeys.get(norm(c)) ?? 0) + 1);
const wantKeys = new Map<string, number>();
for (const c of want.citations) wantKeys.set(norm(c), (wantKeys.get(norm(c)) ?? 0) + 1);

const missing: string[] = [];
const extra: string[] = [];
for (const [k, n] of wantKeys) {
  const g = gotKeys.get(k) ?? 0;
  if (g < n) missing.push(`${k} (need ${n}, got ${g})`);
}
for (const [k, n] of gotKeys) {
  const w = wantKeys.get(k) ?? 0;
  if (n > w) extra.push(`${k} (got ${n}, expected ${w})`);
}

if (missing.length > 0 || extra.length > 0) {
  console.error("FAIL: citation set mismatch");
  if (missing.length > 0) console.error("  missing:", missing);
  if (extra.length > 0) console.error("  extra:", extra);
  process.exit(1);
}
console.log(`PASS: ${got.citations.length} citations match`);
process.exit(0);
