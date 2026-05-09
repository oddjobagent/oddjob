import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BlueprintParseError } from "./errors.ts";
import { parseBlueprint } from "./parse.ts";

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "oddjob-bp-parse-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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

  test('accepts tools = [{name="bash"}] without explicit confirm', () => {
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

// Script mode: [entry] block + auto-detect from main.{ts,js,py,go} sibling.
// Pure-TOML blueprints continue to behave exactly as before — the entry
// surface is purely additive.
const SCRIPT_META = `
name = "pipeline"
version = "0.1.0"
description = "Script-mode pipeline"
author = "demo"
`;

describe("parseBlueprint - script mode (B2.1)", () => {
  test("[entry] block round-trips through schema + validator", () => {
    const toml = `${SCRIPT_META}
[entry]
runtime = "bun"
file = "main.ts"
input_schema = "main.ts#inputSchema"
output_schema = "main.ts#outputSchema"
`;
    const b = parseBlueprint(toml, { path: "/tmp/blueprint.toml" });
    expect(b.scriptMode).toBe(true);
    expect(b.entry?.runtime).toBe("bun");
    expect(b.entry?.file).toBe("main.ts");
    expect(b.entry?.inputSchema).toBe("main.ts#inputSchema");
    expect(b.entry?.outputSchema).toBe("main.ts#outputSchema");
    expect(b.prompt).toBe("");
  });

  test("[entry] without optional schema members works", () => {
    const toml = `${SCRIPT_META}
[entry]
runtime = "python"
file = "main.py"
`;
    const b = parseBlueprint(toml, { path: "/tmp/blueprint.toml" });
    expect(b.scriptMode).toBe(true);
    expect(b.entry?.runtime).toBe("python");
    expect(b.entry?.inputSchema).toBeUndefined();
  });

  test("auto-detects script mode from main.ts sibling", async () => {
    await withDir(async (dir) => {
      const tomlPath = join(dir, "blueprint.toml");
      await writeFile(tomlPath, SCRIPT_META);
      await writeFile(join(dir, "main.ts"), "export default {};\n");
      const b = parseBlueprint(SCRIPT_META, { path: tomlPath });
      expect(b.scriptMode).toBe(true);
      expect(b.entry).toBeUndefined();
    });
  });

  test("auto-detects script mode from main.py sibling", async () => {
    await withDir(async (dir) => {
      const tomlPath = join(dir, "blueprint.toml");
      await writeFile(tomlPath, SCRIPT_META);
      await writeFile(join(dir, "main.py"), "def run():\n    pass\n");
      const b = parseBlueprint(SCRIPT_META, { path: tomlPath });
      expect(b.scriptMode).toBe(true);
    });
  });

  test("script mode + top-level prompt → error with ctx.runAgent hint", () => {
    const toml = `${SCRIPT_META}
prompt = "do the thing"

[entry]
runtime = "bun"
file = "main.ts"
`;
    expect(() => parseBlueprint(toml, { path: "/tmp/blueprint.toml" })).toThrow(
      /script mode.*ctx\.runAgent/s,
    );
  });

  test("script mode + outcomes block → forbidden", () => {
    const toml = `${SCRIPT_META}
[entry]
runtime = "bun"
file = "main.ts"

[outcomes]
success = "we did it"
`;
    expect(() => parseBlueprint(toml, { path: "/tmp/blueprint.toml" })).toThrow(
      /script mode.*'outcomes'/s,
    );
  });

  test("script mode keeps tools/skills/connectors/scripts allowed", () => {
    const toml = `${SCRIPT_META}
tools = ["bash"]
skills = ["seo-analyst"]

[entry]
runtime = "bun"
file = "main.ts"

[connectors.fs]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
auth = "none"

[scripts]
helper = "scripts/helper.ts"
`;
    const b = parseBlueprint(toml, { path: "/tmp/blueprint.toml" });
    expect(b.scriptMode).toBe(true);
    expect(b.tools).toEqual(["bash"]);
    expect(b.skills).toEqual(["seo-analyst"]);
    expect(b.connectors.fs?.transport).toBe("stdio");
    expect(b.scripts.helper).toBe("scripts/helper.ts");
  });

  test("invalid runtime literal → schema error", () => {
    const toml = `${SCRIPT_META}
[entry]
runtime = "rust"
file = "main.rs"
`;
    expect(() => parseBlueprint(toml, { path: "/tmp/blueprint.toml" })).toThrow(
      /entry\.runtime|allowed values/i,
    );
  });

  test("missing entry.file → schema error", () => {
    const toml = `${SCRIPT_META}
[entry]
runtime = "bun"
`;
    expect(() => parseBlueprint(toml, { path: "/tmp/blueprint.toml" })).toThrow(/file/);
  });

  test("rejects empty entry.file", () => {
    const toml = `${SCRIPT_META}
[entry]
runtime = "bun"
file = ""
`;
    expect(() => parseBlueprint(toml, { path: "/tmp/blueprint.toml" })).toThrow(/file/);
  });

  test("rejects unknown key inside [entry]", () => {
    const toml = `${SCRIPT_META}
[entry]
runtime = "bun"
file = "main.ts"
weird = true
`;
    expect(() => parseBlueprint(toml, { path: "/tmp/blueprint.toml" })).toThrow(
      /weird|Unrecognized/,
    );
  });

  test("pure-TOML (no entry, no main.* sibling) still works as before", () => {
    // Backwards-compat: existing blueprint with prompt + model parses fine and
    // is not flagged as script-mode.
    const b = parseBlueprint(MIN_VALID, { path: "/tmp/blueprint.toml" });
    expect(b.scriptMode).toBeFalsy();
    expect(b.entry).toBeUndefined();
    expect(b.prompt).toBe("Echo the user input.");
  });

  test("agent-mode with no prompt still rejected", () => {
    // Removing the prompt line from MIN_VALID — agent mode (no entry, no
    // main.* sibling) requires a prompt.
    const toml = SCRIPT_META + 'model = "openrouter/anthropic/claude-sonnet-4"\n';
    expect(() => parseBlueprint(toml, { path: "/tmp/blueprint.toml" })).toThrow(
      BlueprintParseError,
    );
    expect(() => parseBlueprint(toml, { path: "/tmp/blueprint.toml" })).toThrow(/prompt/);
  });
});
