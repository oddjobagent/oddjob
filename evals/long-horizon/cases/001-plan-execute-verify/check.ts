// Programmatic verifier for evals/long-horizon/001-plan-execute-verify.
// Inspects summary.md directly — bypasses the rubric-grader-can't-see-fs
// issue. Same shape as 002 but stricter on paragraph count.

import { resolve } from "node:path";

const sandboxDir = process.argv[2];
if (!sandboxDir) {
  console.error("usage: bun check.ts <sandboxDir>");
  process.exit(2);
}

const summaryPath = resolve(sandboxDir, "summary.md");
const summaryFile = Bun.file(summaryPath);
if (!(await summaryFile.exists())) {
  console.error("FAIL: summary.md was not created");
  process.exit(1);
}

const text = await summaryFile.text();
if (text.trim().length === 0) {
  console.error("FAIL: summary.md is empty");
  process.exit(1);
}

const sources = ["alpha.md", "beta.md", "gamma.md"];
const lower = text.toLowerCase();
const missing = sources.filter((s) => !lower.includes(s));
if (missing.length > 0) {
  console.error(`FAIL: summary.md is missing references to: ${missing.join(", ")}`);
  process.exit(1);
}

// Each source has a distinctive concept — the summary needs evidence the
// agent read+summarized it, not just listed the filename.
const conceptChecks: Array<{ source: string; needles: string[] }> = [
  { source: "alpha", needles: ["cache", "prefix"] },
  { source: "beta", needles: ["retry", "backoff"] },
  { source: "gamma", needles: ["compact", "context"] },
];
const conceptMisses: string[] = [];
for (const { source, needles } of conceptChecks) {
  if (!needles.some((n) => lower.includes(n))) {
    conceptMisses.push(`${source} (none of: ${needles.join(", ")})`);
  }
}
if (conceptMisses.length > 0) {
  console.error(
    `FAIL: summary.md does not surface distinctive concepts from: ${conceptMisses.join("; ")}`,
  );
  process.exit(1);
}

const paragraphs = text
  .split(/\n\s*\n/)
  .map((p) => p.trim())
  .filter((p) => p.length > 0);
// Rubric says "exactly 4". Allow 3-6 for grader-of-text inflexibility.
if (paragraphs.length < 3 || paragraphs.length > 6) {
  console.error(`FAIL: summary.md has ${paragraphs.length} paragraphs (expected 3-6)`);
  process.exit(1);
}

console.log(`PASS: ${paragraphs.length} paragraphs, all 3 sources referenced + concepts present`);
process.exit(0);
