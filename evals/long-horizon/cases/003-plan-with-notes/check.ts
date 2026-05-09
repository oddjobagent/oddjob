// Programmatic verifier for evals/long-horizon/003-plan-with-notes.
// Inspects:
//   1. <sandboxDir>/.oddjob/notes.md exists with at least one [plan] heading
//      and one [progress] heading (proves notes_append was used).
//   2. <sandboxDir>/src/math.ts has cube() exported (was missing) AND
//      square() returns n*n AND factorial() has a base case.
//   3. `bun test` exits 0 in the post-run fixture.
//
// argv[2] = sandboxDir

import { resolve } from "node:path";

const sandboxDir = process.argv[2];
if (!sandboxDir) {
  console.error("usage: bun check.ts <sandboxDir>");
  process.exit(2);
}

const notesPath = resolve(sandboxDir, ".oddjob/notes.md");
const notesFile = Bun.file(notesPath);
if (!(await notesFile.exists())) {
  console.error("FAIL: .oddjob/notes.md missing — agent did not use notes_append");
  process.exit(1);
}
const notes = await notesFile.text();
if (!/^## \[plan\]/m.test(notes)) {
  console.error("FAIL: notes.md missing a [plan] heading");
  process.exit(1);
}
if (!/^## \[progress\]/m.test(notes)) {
  console.error("FAIL: notes.md missing a [progress] heading");
  process.exit(1);
}

// Run bun test — the real gate is "all 3 tests pass."
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
console.log("PASS: notes.md present + plan + progress headings + all tests pass");
process.exit(0);
