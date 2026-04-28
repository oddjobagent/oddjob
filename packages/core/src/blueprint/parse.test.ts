import { describe, expect, test } from "bun:test";

import { BlueprintParseError } from "./errors.ts";
import { parseBlueprint } from "./parse.ts";

const MIN_VALID = `
name = "echo"
version = "0.1.0"
description = "Echo agent"
author = "demo"
model = "openrouter/anthropic/claude-sonnet-4"
prompt = "Echo the user input."
`;

describe("parseBlueprint - happy paths", () => {
  test("minimal blueprint", () => {
    const b = parseBlueprint(MIN_VALID, { path: "/tmp/blueprint.toml" });
    expect(b.name).toBe("echo");
    expect(b.namespace).toBe("demo");
    expect(b.author).toBe("demo");
    expect(b.version).toBe("0.1.0");
    expect(b.tags).toEqual([]);
    expect(b.license).toBe("MIT");
    expect(b.memory.store).toBe("kv");
    expect(b.memory.retention).toBe("30d");
    expect(b.connectors).toEqual({});
    expect(b.scripts).toEqual({});
    expect(b.outputSchema).toBeUndefined();
  });

  test("with stdio connector", () => {
    const toml = `${MIN_VALID}
[connectors.fs]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
auth = "none"
tools = ["read_file", "list_directory"]
`;
    const b = parseBlueprint(toml, { path: "/tmp/blueprint.toml" });
    const fs = b.connectors.fs;
    expect(fs).toBeDefined();
    expect(fs?.transport).toBe("stdio");
    expect(fs?.transport === "stdio" ? fs.command : null).toBe("npx");
    expect(fs?.tools).toEqual(["read_file", "list_directory"]);
  });

  test("with http connector + oauth2", () => {
    const toml = `${MIN_VALID}
[connectors.gsc]
server = "https://mcp.google.com/gsc"
auth = "oauth2"
scopes = ["read"]
`;
    const b = parseBlueprint(toml, { path: "/tmp/blueprint.toml" });
    const gsc = b.connectors.gsc;
    expect(gsc?.transport).toBe("http");
    expect(gsc?.auth.kind).toBe("oauth2");
  });

  test("with inline json_schema as TOML table", () => {
    const toml = `${MIN_VALID}
[output_schema.json_schema]
type = "object"
[output_schema.json_schema.properties]
[output_schema.json_schema.properties.title]
type = "string"
`;
    const b = parseBlueprint(toml, { path: "/tmp/blueprint.toml" });
    expect(b.outputSchema?.type).toBe("json-schema");
    expect(b.outputSchema?.schema.type).toBe("object");
    expect(b.outputSchemaFile).toBeUndefined();
  });

  test("with inline json_schema as JSON heredoc", () => {
    const toml = `${MIN_VALID}
[output_schema]
json_schema = """
{
  "type": "object",
  "properties": { "title": { "type": "string" } }
}
"""
`;
    const b = parseBlueprint(toml, { path: "/tmp/blueprint.toml" });
    expect(b.outputSchema?.type).toBe("json-schema");
    expect((b.outputSchema!.schema as Record<string, unknown>).type).toBe("object");
  });

  test("with json_schema_file leaves outputSchemaFile pending", () => {
    const toml = `${MIN_VALID}
[output_schema]
json_schema_file = "./output.schema.json"
`;
    const b = parseBlueprint(toml, { path: "/tmp/blueprint.toml" });
    expect(b.outputSchema).toBeUndefined();
    expect(b.outputSchemaFile).toBe("./output.schema.json");
  });

  test("rejects both json_schema and json_schema_file", () => {
    const toml = `${MIN_VALID}
[output_schema]
json_schema_file = "./out.json"
json_schema = "{}"
`;
    expect(() => parseBlueprint(toml, { path: "/tmp/blueprint.toml" })).toThrow(/exactly one/);
  });

  test("rejects invalid JSON heredoc", () => {
    const toml = `${MIN_VALID}
[output_schema]
json_schema = "not json"
`;
    expect(() => parseBlueprint(toml, { path: "/tmp/blueprint.toml" })).toThrow(/invalid JSON/);
  });

  test("with scripts and skills", () => {
    const toml = `${MIN_VALID}
tools = ["web_search"]
skills = ["seo-analyst"]

[scripts]
parse_data = "scripts/parse_data.ts"
format_report = "scripts/format_report.ts"

[secrets]
api = "OPENROUTER_API_KEY"
`;
    const b = parseBlueprint(toml, { path: "/tmp/blueprint.toml" });
    expect(b.tools).toEqual(["web_search"]);
    expect(b.skills).toEqual(["seo-analyst"]);
    expect(b.scripts.parse_data).toBe("scripts/parse_data.ts");
    expect(b.secrets.api).toBe("OPENROUTER_API_KEY");
  });
});

describe("parseBlueprint - identity & hash", () => {
  test("derives id and contentHash", () => {
    const a = parseBlueprint(MIN_VALID, { path: "/tmp/blueprint.toml" });
    const b = parseBlueprint(MIN_VALID, { path: "/tmp/other.toml" });
    expect(a.id).toBe("demo/echo");
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.schemaVersion).toBe(1);
  });

  test("contentHash changes when source changes", () => {
    const a = parseBlueprint(MIN_VALID, { path: "/tmp/blueprint.toml" });
    const modified = MIN_VALID.replace(
      'description = "Echo agent"',
      'description = "Echo agent v2"',
    );
    const b = parseBlueprint(modified, { path: "/tmp/blueprint.toml" });
    expect(a.contentHash).not.toBe(b.contentHash);
  });
});

describe("parseBlueprint - strict schema", () => {
  test("rejects unknown top-level key (typo guard)", () => {
    const toml = `${MIN_VALID}\nmodelz = "wrong"`;
    expect(() => parseBlueprint(toml, { path: "/tmp/x" })).toThrow(/modelz|Unrecognized/);
  });

  test("rejects unknown key inside connector", () => {
    const toml = `${MIN_VALID}
[connectors.x]
server = "https://example.com"
auth = "none"
weird = true
`;
    expect(() => parseBlueprint(toml, { path: "/tmp/x" })).toThrow(/connectors\.x/);
  });
});

describe("parseBlueprint - sad paths", () => {
  test("malformed TOML", () => {
    expect(() => parseBlueprint("name = ", { path: "/tmp/x" })).toThrow(BlueprintParseError);
  });

  test("missing required name", () => {
    const toml = MIN_VALID.replace('name = "echo"', "");
    expect(() => parseBlueprint(toml, { path: "/tmp/x" })).toThrow(/name/);
  });

  test("invalid name format (uppercase)", () => {
    const toml = MIN_VALID.replace('name = "echo"', 'name = "Echo"');
    expect(() => parseBlueprint(toml, { path: "/tmp/x" })).toThrow(/name/);
  });

  test("invalid semver", () => {
    const toml = MIN_VALID.replace('version = "0.1.0"', 'version = "v1"');
    expect(() => parseBlueprint(toml, { path: "/tmp/x" })).toThrow(/version/);
  });

  test("description too long", () => {
    const long = "x".repeat(501);
    const toml = MIN_VALID.replace('description = "Echo agent"', `description = "${long}"`);
    expect(() => parseBlueprint(toml, { path: "/tmp/x" })).toThrow(/description/);
  });

  test("connector with both server and command", () => {
    const toml = `${MIN_VALID}
[connectors.bad]
server = "https://example.com"
command = "npx"
`;
    expect(() => parseBlueprint(toml, { path: "/tmp/x" })).toThrow(/connectors\.bad/);
  });

  test("connector with neither server nor command", () => {
    const toml = `${MIN_VALID}
[connectors.bad]
auth = "none"
`;
    expect(() => parseBlueprint(toml, { path: "/tmp/x" })).toThrow();
  });

  test("api_key auth shorthand without secret_ref", () => {
    const toml = `${MIN_VALID}
[connectors.x]
server = "https://example.com"
auth = "api_key"
`;
    expect(() => parseBlueprint(toml, { path: "/tmp/x" })).toThrow(/api_key.*secret_ref/);
  });

  test("rejects connector key that doesn't match NAME_PATTERN (uppercase)", () => {
    const toml = `${MIN_VALID}
[connectors.Bad]
server = "https://example.com"
`;
    expect(() => parseBlueprint(toml, { path: "/tmp/x" })).toThrow();
  });

  test("rejects script key that doesn't match TOOL_NAME_PATTERN (hyphen)", () => {
    const toml = `${MIN_VALID}
[scripts]
"bad-name" = "echo hi"
`;
    expect(() => parseBlueprint(toml, { path: "/tmp/x" })).toThrow();
  });

  test("accepts tools = [{name=\"bash\"}] without explicit confirm", () => {
    const toml = `${MIN_VALID}
[[tools]]
name = "bash"
`;
    expect(() => parseBlueprint(toml, { path: "/tmp/x" })).not.toThrow();
  });

  test("invalid memory retention", () => {
    const toml = `${MIN_VALID}
[memory]
retention = "forever"
`;
    expect(() => parseBlueprint(toml, { path: "/tmp/x" })).toThrow(/retention/);
  });

  test("missing prompt", () => {
    const toml = MIN_VALID.replace('prompt = "Echo the user input."', 'prompt = ""');
    expect(() => parseBlueprint(toml, { path: "/tmp/x" })).toThrow();
  });
});
