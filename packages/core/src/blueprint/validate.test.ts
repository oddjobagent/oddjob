import { describe, expect, test } from "bun:test";

import type { Blueprint } from "../types/blueprint.ts";
import { BlueprintValidationError } from "./errors.ts";
import { validateBlueprint } from "./validate.ts";

function fixture(over: Partial<Blueprint> = {}): Blueprint {
  return {
    id: "demo/echo",
    name: "echo",
    namespace: "demo",
    version: "0.1.0",
    schemaVersion: 1,
    description: "test",
    author: "demo",
    tags: [],
    license: "MIT",
    model: "openrouter/anthropic/claude-sonnet-4",
    prompt: "Echo.",
    tools: [],
    skills: [],
    connectors: {},
    scripts: {},
    memory: { store: "kv", retention: "30d" },
    secrets: {},
    failOnToolError: true,
    path: "/tmp/blueprint.toml",
    contentHash: "0".repeat(64),
    ...over,
  };
}

describe("validateBlueprint", () => {
  test("passes minimal valid blueprint without fs check", () => {
    expect(() => validateBlueprint(fixture(), { checkFs: false })).not.toThrow();
  });

  test("rejects bad secret_ref casing", () => {
    expect(() =>
      validateBlueprint(fixture({ secrets: { api: "lowerCaseKey" } }), { checkFs: false }),
    ).toThrow(BlueprintValidationError);
  });

  test("rejects bad output_schema top type", () => {
    expect(() =>
      validateBlueprint(
        fixture({ outputSchema: { type: "json-schema", schema: { type: "string" } } }),
        { checkFs: false },
      ),
    ).toThrow(BlueprintValidationError);
  });

  test("rejects connector api_key without secret_ref", () => {
    expect(() =>
      validateBlueprint(
        fixture({
          connectors: {
            x: {
              transport: "http",
              server: "https://example.com",
              auth: { kind: "api_key", secretRef: "" },
            },
          },
        }),
        { checkFs: false },
      ),
    ).toThrow(BlueprintValidationError);
  });

  test("rejects missing script file when checkFs=true", () => {
    expect(() =>
      validateBlueprint(fixture({ scripts: { parse: "scripts/missing.ts" } }), { checkFs: true }),
    ).toThrow(BlueprintValidationError);
  });

  test("rejects script path that escapes blueprint directory", () => {
    expect(() =>
      validateBlueprint(fixture({ scripts: { parse: "../../etc/passwd" } }), { checkFs: false }),
    ).toThrow(/escapes/);
  });

  test("rejects absolute script path", () => {
    expect(() =>
      validateBlueprint(fixture({ scripts: { parse: "/etc/hosts" } }), { checkFs: false }),
    ).toThrow(/relative/);
  });

  test("accepts known built-in tools", () => {
    expect(() =>
      validateBlueprint(fixture({ tools: ["bash", "web_fetch", "python_repl"] }), {
        checkFs: false,
      }),
    ).not.toThrow();
  });

  test("rejects unknown built-in tool with did-you-mean", () => {
    expect(() => validateBlueprint(fixture({ tools: ["bsh"] }), { checkFs: false })).toThrow(
      /did you mean 'bash'/,
    );
  });

  test("rejects unknown built-in tool without near match", () => {
    expect(() =>
      validateBlueprint(fixture({ tools: ["totally-not-a-tool"] }), { checkFs: false }),
    ).toThrow(/unknown tool/);
  });

  test("rejects built-in colliding with script of same name", () => {
    expect(() =>
      validateBlueprint(fixture({ tools: ["bash"], scripts: { bash: "scripts/bash.sh" } }), {
        checkFs: false,
      }),
    ).toThrow(/collides/);
  });
});
