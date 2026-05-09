// Programmatic verifier for evals/web-research/007-pricing-page.
// Pass criteria:
//   - All 4 tier names appear in the output (free, pro, team, enterprise).
//   - The headline annual prices ($12 pro, $24 team) are mentioned.
//   - Add-on prices ($99 flat support, $0.05/GB storage) are NOT listed
//     as tier prices (heuristic: avoid listing "$99" as a tier).

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
const lower = text.toLowerCase();

const tiers = ["free", "pro", "team", "enterprise"];
const missingTiers = tiers.filter((t) => !new RegExp(`\\b${t}\\b`, "i").test(lower));
const errors: string[] = [];
if (missingTiers.length > 0) errors.push(`missing tier names: ${missingTiers.join(", ")}`);

// Annual prices: $12 (pro) and $24 (team) must appear.
if (!/\$\s*12\b/.test(text)) errors.push("missing Pro annual price ($12)");
if (!/\$\s*24\b/.test(text)) errors.push("missing Team annual price ($24)");

// Forbidden: $99 listed as a tier price. Heuristic: $99 appears WITH
// "tier" or "Premium support" should be flagged differently than
// "$99/mo" → if $99 appears within 60 chars of "tier" we fail.
if (/\$\s*99[\s\S]{0,60}tier/i.test(text) || /tier[\s\S]{0,60}\$\s*99/i.test(text)) {
  errors.push("output appears to list the $99 add-on as a tier");
}
// Forbidden: $0.05 listed as a tier
if (/\$\s*0\.05[\s\S]{0,60}tier/i.test(text) || /tier[\s\S]{0,60}\$\s*0\.05/i.test(text)) {
  errors.push("output appears to list the $0.05/GB add-on as a tier");
}

if (errors.length > 0) {
  console.error("FAIL:\n  - " + errors.join("\n  - "));
  process.exit(1);
}
console.log(`PASS: 4 tiers + annual prices ($12, $24) present, add-ons not treated as tiers`);
process.exit(0);
