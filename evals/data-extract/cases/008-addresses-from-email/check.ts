// Programmatic verifier for evals/data-extract/008-addresses-from-email.
// Address parsing has format ambiguity (Tokyo wards, suite-prefix streets,
// etc.) so we check by:
//   1. Schema is correct (array of {street,city,region,postal,country}).
//   2. The set of streets matches expected (the most distinctive field).
//   3. Each expected address's postal code appears alongside its street in
//      the same row (loose multi-field check that's robust to format
//      variation).
//   4. The two near-miss / vacated addresses do NOT appear (P.O. Box,
//      "One Market Plaza" SF — we explicitly told the agent to skip).

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

interface Addr {
  street: string;
  city: string;
  region: string;
  postal: string;
  country: string;
}
interface Shape {
  addresses: Addr[];
}
const isAddr = (v: unknown): v is Addr => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.street === "string" &&
    typeof r.city === "string" &&
    typeof r.region === "string" &&
    typeof r.postal === "string" &&
    typeof r.country === "string"
  );
};
const isShape = (v: unknown): v is Shape => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return Array.isArray(r.addresses) && r.addresses.every(isAddr);
};

const got = (await Bun.file(outPath).json().catch(() => null)) as unknown;
if (got === null) {
  console.error("FAIL: agent did not produce a structured output (.eval-output.json missing)");
  process.exit(1);
}
if (!isShape(got)) {
  console.error("FAIL: output does not match {addresses: [{street,city,region,postal,country}]}");
  process.exit(1);
}
const want = (await Bun.file(expectedPath).json()) as Shape;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const gotStreets = new Set(got.addresses.map((a) => norm(a.street)));
const wantStreets = new Set(want.addresses.map((a) => norm(a.street)));

// The two excluded near-misses must not appear by street
const forbidden = ["one market plaza", "p.o. box 7777", "po box 7777"];
const presentForbidden = forbidden.filter((f) => [...gotStreets].some((s) => s.includes(f)));
if (presentForbidden.length > 0) {
  console.error(`FAIL: forbidden (vacated/near-miss) streets present: ${presentForbidden.join(", ")}`);
  process.exit(1);
}

const missingStreets = [...wantStreets].filter((s) => !gotStreets.has(s));
const extraStreets = [...gotStreets].filter((s) => !wantStreets.has(s));
if (missingStreets.length > 0 || extraStreets.length > 0) {
  console.error("FAIL: street set mismatch");
  if (missingStreets.length > 0) console.error("  missing:", missingStreets);
  if (extraStreets.length > 0) console.error("  extra:", extraStreets);
  process.exit(1);
}

// Per-row: each expected (street,postal) pair must co-occur in some
// returned row.
for (const w of want.addresses) {
  const wStreet = norm(w.street);
  const wPostal = norm(w.postal);
  const match = got.addresses.find(
    (g) => norm(g.street) === wStreet && norm(g.postal) === wPostal,
  );
  if (!match) {
    console.error(`FAIL: no row pairs street "${w.street}" with postal "${w.postal}"`);
    process.exit(1);
  }
}

console.log(`PASS: ${got.addresses.length} addresses match (streets + postals)`);
process.exit(0);
