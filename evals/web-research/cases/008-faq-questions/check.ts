// Programmatic verifier for evals/web-research/008-faq-questions.
// Pass criteria:
//   - At least 6 of 7 question stems appear in the output (case-insensitive
//     substring match on a distinctive phrase from each question).
//   - At least 6 of 7 distinctive answer-tokens appear (verifies the agent
//     also captured the answer, not just the question).
//   - The "Still stuck?" h2 is NOT treated as a question (its identifying
//     phrase is fine to mention; what we don't want is an answer body).

import { resolve } from "node:path";

const sandboxDir = process.argv[2];
if (!sandboxDir) {
  console.error("usage: bun check.ts <sandboxDir>");
  process.exit(2);
}
const outFile = Bun.file(resolve(sandboxDir, ".eval-output.txt"));
if (!(await outFile.exists())) {
  console.error("FAIL: .eval-output.txt missing");
  process.exit(1);
}
const text = await outFile.text();
const lower = text.toLowerCase();

interface Q {
  label: string;
  q: RegExp;
  a: RegExp;
}
const questions: Q[] = [
  { label: "runtime", q: /runtime versions?/i, a: /bun\s*1\.3/i },
  { label: "self-host", q: /self.?host/i, a: /mit/i },
  { label: "migrate", q: /v1\s*to\s*v2|migrate from v1/i, a: /toolbox\s+migrate/i },
  { label: "api", q: /is there an api|\bapi\?/i, a: /\/api\/v1/i },
  { label: "rate-limit", q: /rate.?limit/i, a: /1000|100\s*requests/i },
  { label: "encryption", q: /encrypt/i, a: /aes-?256/i },
  { label: "slack", q: /slack/i, a: /app directory|slash command/i },
];

const missingQ: string[] = [];
const missingA: string[] = [];
for (const { label, q, a } of questions) {
  if (!q.test(lower)) missingQ.push(label);
  if (!a.test(lower)) missingA.push(label);
}
const qMatched = questions.length - missingQ.length;
const aMatched = questions.length - missingA.length;

const errors: string[] = [];
if (qMatched < 6)
  errors.push(`only ${qMatched}/7 question stems present (need ≥ 6); missing: ${missingQ.join(", ")}`);
if (aMatched < 6)
  errors.push(
    `only ${aMatched}/7 distinctive answer-tokens present (need ≥ 6); missing: ${missingA.join(", ")}`,
  );

if (errors.length > 0) {
  console.error("FAIL:\n  - " + errors.join("\n  - "));
  process.exit(1);
}
console.log(`PASS: ${qMatched}/7 questions + ${aMatched}/7 answers recognised`);
process.exit(0);
