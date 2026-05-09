// Programmatic verifier for evals/data-extract/001-emails-from-html.
// Runs OUTSIDE the agent sandbox after the run.
//   argv[2] = sandboxDir (post-run fixture copy). Eval harness writes the
//             agent's structured output to <sandboxDir>/.eval-output.json
//             when the run produced one.
// expected.json lives next to this file (case dir).

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

type Out = { emails: unknown };

const got = (await Bun.file(outPath).json().catch(() => null)) as Out | null;
if (got === null) {
  console.error("FAIL: agent did not produce a structured output (.eval-output.json missing)");
  process.exit(1);
}
const want = (await Bun.file(expectedPath).json()) as { emails: string[] };

if (
  typeof got !== "object" ||
  !Array.isArray(got.emails) ||
  !got.emails.every((e: unknown) => typeof e === "string")
) {
  console.error("FAIL: output does not match schema {emails: string[]}");
  console.error("got:", JSON.stringify(got));
  process.exit(1);
}

const norm = (s: string) => s.trim().toLowerCase();
const gotSet = new Set((got.emails as string[]).map(norm));
const wantSet = new Set(want.emails.map(norm));

const missing = [...wantSet].filter((e) => !gotSet.has(e));
const extra = [...gotSet].filter((e) => !wantSet.has(e));

if (missing.length > 0 || extra.length > 0) {
  console.error("FAIL: email set mismatch");
  if (missing.length > 0) console.error("  missing:", missing);
  if (extra.length > 0) console.error("  extra:", extra);
  process.exit(1);
}

console.log("PASS: emails match expected set");
process.exit(0);
