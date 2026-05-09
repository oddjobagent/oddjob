// Programmatic verifier for evals/web-research/002-http-status-codes.
//
// argv[2] = sandboxDir; harness writes the agent's final assistant text
// to <sandboxDir>/.eval-output.txt.
//
// Pass criteria:
//   - At least 18 of the 21 4xx codes from the corpus appear in the output
//   - No codes outside the 4xx range appear (1xx/2xx/3xx/5xx are
//     hallucinations / scope creep)
//   - No 4xx codes appear that aren't in the corpus

import { resolve } from "node:path";
import { readFile as fsRead } from "node:fs/promises";

const sandboxDir = process.argv[2];
if (!sandboxDir) {
  console.error("usage: bun check.ts <sandboxDir>");
  process.exit(2);
}

const outPath = resolve(sandboxDir, ".eval-output.txt");
const outFile = Bun.file(outPath);
if (!(await outFile.exists())) {
  console.error("FAIL: .eval-output.txt missing — agent produced no final text");
  process.exit(1);
}
const text = await outFile.text();

// Parse the corpus to extract every 4xx code defined there. The check
// reads the corpus from the sandbox copy (the agent had access to the
// same file); falls back to the case-side path if the agent moved/
// deleted it.
let corpus = "";
try {
  corpus = await fsRead(resolve(sandboxDir, "corpus/mdn-status-codes.html"), "utf8");
} catch {
  // Fallback to the original
  corpus = await fsRead(
    resolve(import.meta.dir ?? __dirname, "fixture/corpus/mdn-status-codes.html"),
    "utf8",
  );
}
const corpusCodes = new Set<string>();
const codeRe = /<code>(\d{3})\b/g;
for (const m of corpus.matchAll(codeRe)) {
  const code = m[1]!;
  if (code.startsWith("4")) corpusCodes.add(code);
}
if (corpusCodes.size < 18) {
  console.error(`FAIL: corpus parse anomaly — only ${corpusCodes.size} 4xx codes found`);
  process.exit(2);
}

// Codes the agent listed
const allMentioned = new Set<string>();
for (const m of text.matchAll(/\b(\d{3})\b/g)) allMentioned.add(m[1]!);

const mentionedFourXx = new Set([...allMentioned].filter((c) => c.startsWith("4")));
const outOfRange = new Set([...allMentioned].filter((c) => !c.startsWith("4")));
const correctlyListed = new Set([...mentionedFourXx].filter((c) => corpusCodes.has(c)));
const hallucinated = new Set([...mentionedFourXx].filter((c) => !corpusCodes.has(c)));
const missed = new Set([...corpusCodes].filter((c) => !mentionedFourXx.has(c)));

const errors: string[] = [];
if (outOfRange.size > 0) errors.push(`out-of-range codes mentioned: ${[...outOfRange].join(", ")}`);
if (hallucinated.size > 0) {
  errors.push(`4xx codes not in corpus (hallucinated): ${[...hallucinated].join(", ")}`);
}
if (correctlyListed.size < 18) {
  errors.push(
    `only ${correctlyListed.size}/${corpusCodes.size} 4xx codes correctly listed (need ≥18). Missed: ${[...missed].slice(0, 10).join(", ")}${missed.size > 10 ? "…" : ""}`,
  );
}
if (errors.length > 0) {
  console.error("FAIL:\n  - " + errors.join("\n  - "));
  process.exit(1);
}
console.log(
  `PASS: ${correctlyListed.size}/${corpusCodes.size} 4xx codes correctly listed; 0 hallucinations; 0 out-of-range mentions`,
);
process.exit(0);
