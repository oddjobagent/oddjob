// Programmatic verifier for evals/long-horizon/004-refactor-with-tests.
// Asserts:
//   1. Every non-test src/*.ts has a corresponding *.test.ts file.
//   2. `bun test` exits 0 (all tests pass after the agent's fixes).

import { resolve } from "node:path";
import { readdir } from "node:fs/promises";

const sandboxDir = process.argv[2];
if (!sandboxDir) {
  console.error("usage: bun check.ts <sandboxDir>");
  process.exit(2);
}

const srcDir = resolve(sandboxDir, "src");
const entries = await readdir(srcDir).catch(() => null);
if (entries === null) {
  console.error(`FAIL: src/ missing in ${srcDir}`);
  process.exit(1);
}

const tsFiles = entries.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const testFiles = new Set(entries.filter((f) => f.endsWith(".test.ts")));
const missing: string[] = [];
for (const f of tsFiles) {
  const stem = f.slice(0, -3);
  if (!testFiles.has(`${stem}.test.ts`)) missing.push(`${stem}.test.ts`);
}
if (missing.length > 0) {
  console.error(`FAIL: missing test files: ${missing.join(", ")}`);
  process.exit(1);
}

const proc = Bun.spawn({
  cmd: ["bun", "test"],
  cwd: sandboxDir,
  stdout: "pipe",
  stderr: "pipe",
});
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
]);
if (exitCode !== 0) {
  console.error(`FAIL: bun test exit ${exitCode}`);
  console.error("--- stdout ---\n" + stdout);
  console.error("--- stderr ---\n" + stderr);
  process.exit(1);
}

console.log(`PASS: ${tsFiles.length} src files all have .test.ts; bun test exit 0`);
process.exit(0);
