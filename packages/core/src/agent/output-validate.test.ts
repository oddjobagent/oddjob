import { describe, expect, test } from "bun:test";

import type { Blueprint } from "../types/blueprint.ts";

import { validateOutput } from "./output-validate.ts";

const base: Blueprint = {
  id: "demo/x",
  name: "x",
  namespace: "demo",
  version: "0.0.0",
  schemaVersion: 1,
  description: "",
  author: "demo",
  tags: [],
  license: "MIT",
  model: "faux/test",
  prompt: "",
  tools: [],
  skills: [],
  connectors: {},
  scripts: {},
  memory: { store: "kv", retention: "30d" },
  secrets: {},
  failOnToolError: false,
  path: "/tmp/x",
  contentHash: "0".repeat(64),
};

describe("validateOutput", () => {
  test("skipped when no schema", () => {
    const r = validateOutput(base, { foo: 1 });
    expect(r.ok).toBe(true);
    expect(r.source).toBe("skipped");
  });

  test("no-output when schema present but output missing", () => {
    const bp: Blueprint = {
      ...base,
      outputSchema: { type: "json-schema", schema: { type: "object" } },
    };
    const r = validateOutput(bp, undefined);
    expect(r.ok).toBe(false);
    expect(r.source).toBe("no-output");
  });

  test("ok on matching schema", () => {
    const bp: Blueprint = {
      ...base,
      outputSchema: {
        type: "json-schema",
        schema: {
          type: "object",
          required: ["title", "count"],
          properties: { title: { type: "string" }, count: { type: "integer" } },
        },
      },
    };
    const r = validateOutput(bp, { title: "hi", count: 3 });
    expect(r.ok).toBe(true);
    expect(r.source).toBe("json-schema");
  });

  test("collects errors on mismatch", () => {
    const bp: Blueprint = {
      ...base,
      outputSchema: {
        type: "json-schema",
        schema: {
          type: "object",
          required: ["title"],
          properties: { title: { type: "string" }, count: { type: "integer" } },
        },
      },
    };
    const r = validateOutput(bp, { count: "not a number" });
    expect(r.ok).toBe(false);
    expect((r.errors ?? []).length).toBeGreaterThan(0);
  });
});
