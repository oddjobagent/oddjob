import { expect, test } from "bun:test";
import { loadConfig } from "./config.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("loadConfig reads a JSON file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  const path = join(dir, "cfg.json");
  writeFileSync(path, JSON.stringify({ greeting: "Howdy" }));
  expect(await loadConfig(path)).toEqual({ greeting: "Howdy" });
});

test("loadConfig falls back to default when file missing", async () => {
  const path = join(tmpdir(), `nonexistent-${Date.now()}-${Math.random()}.json`);
  expect(await loadConfig(path)).toEqual({ greeting: "Hello" });
});
