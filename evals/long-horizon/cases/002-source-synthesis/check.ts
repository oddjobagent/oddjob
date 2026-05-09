// Programmatic verifier for evals/long-horizon/002-source-synthesis.
// Inspects filesystem state directly — does NOT rely on the agent's
// report_status text. (The grader can only see the final assistant
// message, which a terse report_status summary doesn't satisfy even when
// the work landed on disk.)
//
// argv[2] = sandboxDir (post-run fixture copy with summary.md written by
//           agent)
//
// Asserts beyond filename references: each source has a distinctive
// concept that should appear if the agent actually read+synthesised that
// source. A "filenames-only" stub fails because none of these key terms
// will land in the body.

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

const expectedSources = ["alpha.md", "beta.md", "gamma.md", "delta.md", "epsilon.md", "zeta.md"];
const lower = text.toLowerCase();
const missingFile = expectedSources.filter((s) => !lower.includes(s));
if (missingFile.length > 0) {
  console.error(`FAIL: summary.md is missing references to: ${missingFile.join(", ")}`);
  process.exit(1);
}

// Each source has a distinctive concept. The summary should mention each
// (case-insensitive substring match — multiple synonyms accepted). A
// minimal-effort summary that just lists filenames will fail this gate.
const conceptChecks: Array<{ source: string; needles: string[] }> = [
  { source: "alpha", needles: ["cache", "prompt"] }, // alpha = caching strategies
  { source: "beta", needles: ["retry", "tool"] }, // beta = retry semantics + side-effect guard
  { source: "gamma", needles: ["compact", "context"] }, // gamma = context-window compaction
  { source: "delta", needles: ["truncat", "8"] }, // delta = tool-result truncation @ 8KB
  { source: "epsilon", needles: ["note", "scratch"] }, // epsilon = scratchpad notes
  { source: "zeta", needles: ["skill", "manifest"] }, // zeta = JIT skill loading
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

// Final paragraph should explicitly synthesize — look for synthesis
// language. Bare filename-listing won't trip these patterns.
const synthRe =
  /\b(common thread|unifying|theme|contradiction|all six|tension|trade.?off|pattern|across the|in summary|together|share)\b/i;
const lastParaIdx = text.trimEnd().lastIndexOf("\n\n");
const lastPara = lastParaIdx >= 0 ? text.slice(lastParaIdx).trim() : text.trim();
if (!synthRe.test(lastPara)) {
  console.error(
    "FAIL: closing paragraph does not contain explicit synthesis language (theme/contradiction/trade-off/etc.)",
  );
  console.error(`closing paragraph was: ${lastPara.slice(0, 200)}...`);
  process.exit(1);
}

const paragraphs = text
  .split(/\n\s*\n/)
  .map((p) => p.trim())
  .filter((p) => p.length > 0);
if (paragraphs.length < 4 || paragraphs.length > 25) {
  console.error(`FAIL: summary.md has ${paragraphs.length} paragraphs (expected 4-25)`);
  process.exit(1);
}

console.log(
  `PASS: ${paragraphs.length} paragraphs, all 6 sources referenced + concept-specific terms present + synthesis language in closing`,
);
process.exit(0);
