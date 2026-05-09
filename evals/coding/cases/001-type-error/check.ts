// Programmatic verifier for evals/coding/001-type-error.
// Runs OUTSIDE the agent sandbox after the run completes. The harness passes
// the post-run fixture path as argv[2]. Asserts `bun test` exits 0.
//
// No test framework imports — eval harness expects exit 0 = pass, non-zero =
// fail, with a short stderr diagnostic.

const fixtureDir = process.argv[2];
if (!fixtureDir) {
  console.error("usage: bun check.ts <post-run-fixture-dir>");
  process.exit(2);
}

const proc = Bun.spawn({
  cmd: ["bun", "test"],
  cwd: fixtureDir,
  stdout: "pipe",
  stderr: "pipe",
});

const [stdout, stderr, exitCode] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
]);

if (exitCode !== 0) {
  console.error(`FAIL: bun test exit ${exitCode} in ${fixtureDir}`);
  console.error("--- stdout ---\n" + stdout);
  console.error("--- stderr ---\n" + stderr);
  process.exit(1);
}

console.log("PASS: bun test exit 0");
process.exit(0);
