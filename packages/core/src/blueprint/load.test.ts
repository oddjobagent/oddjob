import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadBlueprint } from "./load.ts";

const MIN_TOML = `name = "demo"
version = "0.1.0"
description = "x"
author = "demo"
model = "openrouter/anthropic/claude-sonnet-4"
prompt = "hi"
`;

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "oddjob-bp-load-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("loadBlueprint sidecar resolution", () => {
  test("resolves .json sidecar relative to blueprint dir", async () => {
    await withDir(async (dir) => {
      await writeFile(
        join(dir, "blueprint.toml"),
        `${MIN_TOML}\n[output_schema]\njson_schema_file = "./out.schema.json"\n`,
      );
      await writeFile(
        join(dir, "out.schema.json"),
        JSON.stringify({ type: "object", required: ["foo"], properties: { foo: { type: "string" } } }),
      );
      const b = await loadBlueprint(dir, { validate: true, checkFs: false });
      expect(b.outputSchema?.type).toBe("json-schema");
      expect((b.outputSchema?.schema as { required: string[] }).required).toEqual(["foo"]);
      expect(b.outputSchemaFile).toBeUndefined();
    });
  });

  test("resolves .ts sidecar via dynamic import (default export)", async () => {
    await withDir(async (dir) => {
      await writeFile(
        join(dir, "blueprint.toml"),
        `${MIN_TOML}\n[output_schema]\njson_schema_file = "./out.schema.ts"\n`,
      );
      await writeFile(
        join(dir, "out.schema.ts"),
        `export default { type: "object", properties: { count: { type: "integer" } } };\n`,
      );
      const b = await loadBlueprint(dir, { validate: true, checkFs: false });
      expect((b.outputSchema?.schema as { type: string }).type).toBe("object");
    });
  });

  test("rejects unsupported sidecar extension", async () => {
    await withDir(async (dir) => {
      await writeFile(
        join(dir, "blueprint.toml"),
        `${MIN_TOML}\n[output_schema]\njson_schema_file = "./out.yaml"\n`,
      );
      await writeFile(join(dir, "out.yaml"), "type: object\n");
      await expect(loadBlueprint(dir, { validate: false })).rejects.toThrow(/unsupported sidecar/);
    });
  });

  test("rejects sidecar that does not exist", async () => {
    await withDir(async (dir) => {
      await writeFile(
        join(dir, "blueprint.toml"),
        `${MIN_TOML}\n[output_schema]\njson_schema_file = "./missing.json"\n`,
      );
      await expect(loadBlueprint(dir, { validate: false })).rejects.toThrow();
    });
  });
});
