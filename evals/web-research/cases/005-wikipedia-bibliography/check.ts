// Programmatic verifier for evals/web-research/005-wikipedia-bibliography.
// Pass criteria:
//   - At least 7 of the 8 References-section citations are recognisable
//     in the output. Each citation's identifying token is the surname +
//     year (e.g. "Turing" appearing within ~80 chars of "1936").

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

interface Cite {
  label: string;
  surname: string;
  year: string;
}
const expected: Cite[] = [
  { label: "Turing 1936", surname: "Turing", year: "1936" },
  { label: "Hodges 1983", surname: "Hodges", year: "1983" },
  { label: "Copeland 2004", surname: "Copeland", year: "2004" },
  { label: "Turing 1950", surname: "Turing", year: "1950" },
  { label: "Newman 1955", surname: "Newman", year: "1955" },
  { label: "Hilbert/Ackermann 1928", surname: "Hilbert", year: "1928" },
  { label: "Church 1936", surname: "Church", year: "1936" },
  { label: "Hodges 2014", surname: "Hodges", year: "2014" },
];

const present: string[] = [];
const missing: string[] = [];
for (const c of expected) {
  const surnameRe = new RegExp(`\\b${c.surname}\\b`, "i");
  const surnameMatches = [...text.matchAll(new RegExp(surnameRe, "gi"))];
  const yearRe = new RegExp(`\\b${c.year}\\b`);
  const yearMatches = [...text.matchAll(new RegExp(yearRe, "g"))];
  let found = false;
  for (const sm of surnameMatches) {
    for (const ym of yearMatches) {
      if (Math.abs((sm.index ?? 0) - (ym.index ?? 0)) <= 120) {
        found = true;
        break;
      }
    }
    if (found) break;
  }
  if (found) present.push(c.label);
  else missing.push(c.label);
}

if (present.length < 7) {
  console.error(
    `FAIL: only ${present.length}/${expected.length} bibliography entries recognised (need ≥ 7). Missing: ${missing.join("; ")}`,
  );
  process.exit(1);
}
console.log(`PASS: ${present.length}/${expected.length} bibliography entries recognised`);
process.exit(0);
