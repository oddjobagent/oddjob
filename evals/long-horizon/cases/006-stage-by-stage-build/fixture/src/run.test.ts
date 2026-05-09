import { expect, test } from "bun:test";
import { run } from "./run.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("run combines flags + config", async () => {
  const dir = mkdtempSync(join(tmpdir(), "run-"));
  const path = join(dir, "cfg.json");
  writeFileSync(path, JSON.stringify({ greeting: "Hola" }));
  expect(await run(["--name", "Ada"], path)).toBe("Hola, Ada!");
});

test("run uppercases when --upper is set", async () => {
  const dir = mkdtempSync(join(tmpdir(), "run-"));
  const path = join(dir, "cfg.json");
  writeFileSync(path, JSON.stringify({ greeting: "Hola" }));
  expect(await run(["--name", "Ada", "--upper"], path)).toBe("HOLA, ADA!");
});

test("run uses default greeting when config missing", async () => {
  const path = join(tmpdir(), `nope-${Date.now()}.json`);
  expect(await run(["--name", "Grace"], path)).toBe("Hello, Grace!");
});
