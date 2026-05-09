// Programmatic verifier for evals/long-horizon/007-explore-then-decide.
// Asserts:
//   1. <sandboxDir>/decision.md exists and identifies Strategy B (the
//      correct choice for the workload in config.json).
//   2. decision.md cites at least two distinctive facts from config.json
//      (qps, latency budget, data size, consistency, hot-key skew).
//   3. `bun test` exits 0.

import { resolve } from "node:path";

const sandboxDir = process.argv[2];
if (!sandboxDir) {
  console.error("usage: bun check.ts <sandboxDir>");
  process.exit(2);
}

const decisionPath = resolve(sandboxDir, "decision.md");
const decisionFile = Bun.file(decisionPath);
if (!(await decisionFile.exists())) {
  console.error("FAIL: decision.md was not created");
  process.exit(1);
}
const text = (await decisionFile.text()).toLowerCase();

if (!/strategy\s*b\b/.test(text)) {
  console.error("FAIL: decision.md does not identify 'Strategy B' as the choice");
  process.exit(1);
}

// At least 2 distinctive config facts referenced.
const configFacts = [
  /50[\s,_]?000|50k|read.?heavy|99%\s*reads?/, // qps + read skew
  /5\s*ms|p99|latency/, // latency budget
  /200\s*gb|data\s*size/, // size
  /eventual|consistency/, // consistency model
  /hot\s*key|top\s*1%|80%/, // skew
  /ttl|expir/, // strategy-B-specific concept
];
const hits = configFacts.filter((re) => re.test(text));
if (hits.length < 2) {
  console.error(`FAIL: decision.md cites only ${hits.length} distinctive config facts (need ≥ 2)`);
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
console.log("PASS: decision.md picks Strategy B with config justification + tests pass");
process.exit(0);
