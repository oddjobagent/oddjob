// Programmatic verifier for evals/web-research/006-changelog-versions.
// Pass criteria:
//   - At least 6 of 7 (version, release-date) pairs co-occur in output.
//   - The "Upcoming: v3.5.0" entry must NOT appear (no release date).

import { resolve } from "node:path";

const sandboxDir = process.argv[2];
if (!sandboxDir) {
  console.error("usage: bun check.ts <sandboxDir>");
  process.exit(2);
}
const outPath = resolve(sandboxDir, ".eval-output.txt");
const outFile = Bun.file(outPath);
if (!(await outFile.exists())) {
  console.error("FAIL: .eval-output.txt missing");
  process.exit(1);
}
const text = await outFile.text();

interface Pair {
  version: string;
  date: string;
}
const expected: Pair[] = [
  { version: "3.4.0", date: "2026-04-22" },
  { version: "3.3.1", date: "2026-03-30" },
  { version: "3.3.0", date: "2026-03-15" },
  { version: "3.2.0", date: "2026-01-10" },
  { version: "3.1.0", date: "2025-11-04" },
  { version: "3.0.0", date: "2025-09-01" },
  { version: "2.9.4", date: "2025-06-12" },
];

let matched = 0;
const misses: string[] = [];
for (const p of expected) {
  const vRe = new RegExp(`v?${p.version.replace(/\./g, "\\.")}`, "g");
  const vMatches = [...text.matchAll(vRe)];
  const dRe = new RegExp(p.date, "g");
  const dMatches = [...text.matchAll(dRe)];
  let found = false;
  for (const v of vMatches) {
    for (const d of dMatches) {
      if (Math.abs((v.index ?? 0) - (d.index ?? 0)) <= 120) {
        found = true;
        break;
      }
    }
    if (found) break;
  }
  if (found) matched++;
  else misses.push(`${p.version}/${p.date}`);
}

const errors: string[] = [];
// Forbidden: v3.5.0 should not appear as a "released" version.
if (/v?3\.5\.0/.test(text) && /(release[ds]?|shipped|published)/i.test(text)) {
  // looser: only fail if 3.5.0 is paired with release language. The safer check
  // is: did the agent list 3.5.0 with any date? If yes, fail.
  if (/v?3\.5\.0[^\n]{0,80}\d{4}-\d{2}-\d{2}/.test(text)) {
    errors.push("output incorrectly includes upcoming version 3.5.0 with a date");
  }
}
if (matched < 6) {
  errors.push(`only ${matched}/${expected.length} (version,date) pairs matched (need ≥ 6). Missing: ${misses.join(", ")}`);
}
if (errors.length > 0) {
  console.error("FAIL:\n  - " + errors.join("\n  - "));
  process.exit(1);
}
console.log(`PASS: ${matched}/${expected.length} version-date pairs matched; upcoming version excluded`);
process.exit(0);
