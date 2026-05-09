// Programmatic verifier for evals/long-horizon/006-stage-by-stage-build.
// Asserts `bun test` exits 0 (all 9 stage tests pass).

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
  console.error(`FAIL: bun test exit ${exitCode}`);
  console.error("--- stdout ---\n" + stdout);
  console.error("--- stderr ---\n" + stderr);
  process.exit(1);
}

console.log("PASS: all 3 stages green");
process.exit(0);
