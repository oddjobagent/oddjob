// Programmatic verifier for evals/long-horizon/008-batch-rename.
// Asserts:
//   1. No `getUser` identifier remains anywhere in src/**/*.ts.
//   2. `bun test` exits 0 (the renamed `fetchUser` works end-to-end).

import { resolve } from "node:path";
import { readdir } from "node:fs/promises";

const sandboxDir = process.argv[2];
if (!sandboxDir) {
  console.error("usage: bun check.ts <post-run-fixture-dir>");
  process.exit(2);
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile() && e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

const srcDir = resolve(sandboxDir, "src");
const files = await walk(srcDir).catch(() => []);
if (files.length === 0) {
  console.error(`FAIL: no .ts files under ${srcDir}`);
  process.exit(1);
}

const offenders: string[] = [];
for (const f of files) {
  const text = await Bun.file(f).text();
  // word-boundary match for the bare identifier
  if (/\bgetUser\b/.test(text)) offenders.push(f);
}
if (offenders.length > 0) {
  console.error(
    `FAIL: ${offenders.length} files still contain 'getUser':\n  - ${offenders.map((f) => f.slice(sandboxDir.length + 1)).join("\n  - ")}`,
  );
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
console.log(`PASS: 0 'getUser' references in ${files.length} src files; bun test exit 0`);
process.exit(0);
