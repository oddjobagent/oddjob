// Programmatic verifier for evals/web-research/003-rfc-dates.
// Reads <sandboxDir>/.eval-output.txt (agent's final assistant text).
// Pass criteria:
//   - At least 9 of the 10 "Issued: YYYY-MM-DD" dates from the corpus
//     appear in the output (lossy threshold mirrors 002-http-status-codes).
//   - No date outside the corpus set appears (no hallucinations like
//     1986-XX-XX or 2017-07-XX from body text).

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

let corpus = "";
try {
  corpus = await fsRead(resolve(sandboxDir, "corpus/rfc-index.html"), "utf8");
} catch {
  corpus = await fsRead(
    resolve(import.meta.dir ?? __dirname, "fixture/corpus/rfc-index.html"),
    "utf8",
  );
}
const corpusDates = new Set<string>();
for (const m of corpus.matchAll(/Issued:\s*(\d{4}-\d{2}-\d{2})/g)) corpusDates.add(m[1]!);
if (corpusDates.size < 9) {
  console.error(`FAIL: corpus parse anomaly — only ${corpusDates.size} issued dates found`);
  process.exit(2);
}

const mentioned = new Set<string>();
for (const m of text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) mentioned.add(m[1]!);

const correct = new Set([...mentioned].filter((d) => corpusDates.has(d)));
const hallucinated = new Set([...mentioned].filter((d) => !corpusDates.has(d)));
const missed = new Set([...corpusDates].filter((d) => !mentioned.has(d)));

const errors: string[] = [];
if (hallucinated.size > 0) {
  errors.push(`dates not in corpus (hallucinated): ${[...hallucinated].join(", ")}`);
}
if (correct.size < 9) {
  errors.push(
    `only ${correct.size}/${corpusDates.size} corpus dates correctly listed (need ≥ 9). Missed: ${[...missed].join(", ")}`,
  );
}
if (errors.length > 0) {
  console.error("FAIL:\n  - " + errors.join("\n  - "));
  process.exit(1);
}
console.log(`PASS: ${correct.size}/${corpusDates.size} dates correct, 0 hallucinations`);
process.exit(0);
