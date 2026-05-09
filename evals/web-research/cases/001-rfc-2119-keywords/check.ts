// Programmatic verifier for evals/web-research/001-rfc-2119-keywords.
// Replaces the rubric path so the gate measures actual correctness, not
// the agent's final-text framing.
//
// argv[2] = sandboxDir; harness writes the agent's final assistant text
// to <sandboxDir>/.eval-output.txt.

import { resolve } from "node:path";

const sandboxDir = process.argv[2];
if (!sandboxDir) {
  console.error("usage: bun check.ts <sandboxDir>");
  process.exit(2);
}

const outPath = resolve(sandboxDir, ".eval-output.txt");
const outFile = Bun.file(outPath);
if (!(await outFile.exists())) {
  console.error("FAIL: agent did not produce a final text response (.eval-output.txt missing)");
  process.exit(1);
}
const text = await outFile.text();
if (text.trim().length === 0) {
  console.error("FAIL: .eval-output.txt is empty");
  process.exit(1);
}

// RFC 2119 defines six keywords: MUST, MUST NOT, SHOULD, SHOULD NOT, MAY,
// REQUIRED, SHALL, SHALL NOT, RECOMMENDED, NOT RECOMMENDED, OPTIONAL.
// The "six" canonical-by-the-rubric set (MUST/SHOULD/MAY family) is:
//   MUST, MUST NOT, SHOULD, SHOULD NOT, MAY, OPTIONAL
// Looser pass: any 5+ of these 6 must appear (case-insensitive).
const upper = text.toUpperCase();
const required = ["MUST", "MUST NOT", "SHOULD", "SHOULD NOT", "MAY", "OPTIONAL"];
const present = required.filter((kw) => upper.includes(kw));
const missing = required.filter((kw) => !upper.includes(kw));
if (present.length < 5) {
  console.error(`FAIL: only ${present.length}/6 keywords present. Missing: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`PASS: ${present.length}/6 keywords present (${missing.length === 0 ? "all" : "missing: " + missing.join(", ")})`);
process.exit(0);
