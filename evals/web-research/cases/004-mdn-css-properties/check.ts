// Programmatic verifier for evals/web-research/004-mdn-css-properties.
// Pass criteria:
//   - At least 12 of the 14 in-scope flexbox properties appear in output.
//   - No "see also" out-of-scope property names appear (grid-*, box-flex).

import { resolve } from "node:path";

const sandboxDir = process.argv[2];
if (!sandboxDir) {
  console.error("usage: bun check.ts <sandboxDir>");
  process.exit(2);
}

const outPath = resolve(sandboxDir, ".eval-output.txt");
const outFile = Bun.file(outPath);
if (!(await outFile.exists())) {
  console.error("FAIL: .eval-output.txt missing");
  process.exit(1);
}
const text = (await outFile.text()).toLowerCase();

const expected = [
  "display",
  "flex-direction",
  "flex-wrap",
  "flex-flow",
  "justify-content",
  "align-items",
  "align-content",
  "gap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "flex",
  "order",
  "align-self",
];
const forbidden = ["grid-template-columns", "grid-area", "grid-gap", "box-flex"];

// "flex" is a substring of others; check word-bounded match.
const present = new Set<string>();
for (const p of expected) {
  const re = new RegExp(`(^|[^a-z-])${p.replace(/-/g, "\\-")}([^a-z-]|$)`, "i");
  if (re.test(text)) present.add(p);
}
const missing = expected.filter((p) => !present.has(p));

const banned: string[] = [];
for (const f of forbidden) {
  const re = new RegExp(`(^|[^a-z-])${f.replace(/-/g, "\\-")}([^a-z-]|$)`, "i");
  if (re.test(text)) banned.push(f);
}

const errors: string[] = [];
if (banned.length > 0) errors.push(`out-of-scope properties mentioned: ${banned.join(", ")}`);
if (present.size < 12) {
  errors.push(`only ${present.size}/${expected.length} in-scope properties listed (need ≥ 12). Missing: ${missing.join(", ")}`);
}
if (errors.length > 0) {
  console.error("FAIL:\n  - " + errors.join("\n  - "));
  process.exit(1);
}
console.log(`PASS: ${present.size}/${expected.length} flexbox properties listed; 0 out-of-scope`);
process.exit(0);
