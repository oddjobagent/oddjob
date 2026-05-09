// Blueprint TOML schema, expressed in typebox.
//
// We compile to JSON Schema and validate with Ajv. Cross-field XOR rules
// (e.g. exactly-one-of json_schema/json_schema_file) live in
// `validateBlueprintRefinements` and run as a second pass after Ajv accepts
// the structural shape, so error messages can stay informative.

import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { type Static, Type } from "typebox";

const NAME_PATTERN = "^[a-z0-9][a-z0-9-]*$";
const TOOL_NAME_PATTERN = "^[a-z0-9][a-z0-9_]*$";
const SEMVER_PATTERN = "^\\d+\\.\\d+\\.\\d+(?:-[a-zA-Z0-9.-]+)?(?:\\+[a-zA-Z0-9.-]+)?$";
const RETENTION_PATTERN = "^\\d+[smhdw]$";

const STRICT = { additionalProperties: false } as const;

// Connector auth — discriminated union plus the legacy bare-string forms.
export const ConnectorAuthSchema = Type.Union([
  Type.Literal("none"),
  Type.Literal("api_key"),
  Type.Literal("bearer"),
  Type.Literal("oauth2"),
  Type.Object({ kind: Type.Literal("none") }, STRICT),
  Type.Object(
    {
      kind: Type.Literal("api_key"),
      header_name: Type.Optional(Type.String()),
      secret_ref: Type.String({ minLength: 1 }),
    },
    STRICT,
  ),
  Type.Object(
    {
      kind: Type.Literal("bearer"),
      secret_ref: Type.String({ minLength: 1 }),
    },
    STRICT,
  ),
  Type.Object(
    {
      kind: Type.Literal("oauth2"),
      client_id_ref: Type.Optional(Type.String()),
      client_secret_ref: Type.Optional(Type.String()),
      authorization_url: Type.Optional(Type.String({ format: "uri" })),
      token_url: Type.Optional(Type.String({ format: "uri" })),
      scopes: Type.Optional(Type.Array(Type.String())),
      use_pkce: Type.Optional(Type.Boolean()),
    },
    STRICT,
  ),
]);

// Single permissive connector schema — both `command` (stdio) and `server`
// (http/sse) are optional. The exactly-one-of XOR rule is enforced by the
// refinement pass (validateBlueprintRefinements) so users see a targeted
// error instead of a noisy `must match a schema in anyOf`.
export const ConnectorSchema = Type.Object(
  {
    transport: Type.Optional(
      Type.Union([Type.Literal("stdio"), Type.Literal("http"), Type.Literal("sse")]),
    ),
    command: Type.Optional(Type.String({ minLength: 1 })),
    args: Type.Optional(Type.Array(Type.String())),
    server: Type.Optional(Type.String({ format: "uri" })),
    auth: Type.Optional(ConnectorAuthSchema),
    scopes: Type.Optional(Type.Array(Type.String())),
    tools: Type.Optional(Type.Array(Type.String())),
    env: Type.Optional(Type.Record(Type.String(), Type.String())),
  },
  STRICT,
);

// Backward-compat aliases (still consumed by some tests / imports).
export const StdioConnectorSchema = ConnectorSchema;
export const HttpConnectorSchema = ConnectorSchema;

export const MemorySchema = Type.Object(
  {
    store: Type.Union([Type.Literal("kv"), Type.Literal("vector"), Type.Literal("both")], {
      default: "kv",
    }),
    retention: Type.String({ pattern: RETENTION_PATTERN, default: "30d" }),
  },
  STRICT,
);

const SchemaSourceSchema = Type.Object(
  {
    json_schema: Type.Optional(
      Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.String()]),
    ),
    json_schema_file: Type.Optional(Type.String({ minLength: 1 })),
  },
  STRICT,
);

export const OutputSchemaSchema = SchemaSourceSchema;
export const InputSchemaSchema = SchemaSourceSchema;

// Script-mode entry block. Presence flips the blueprint into "code-first"
// mode — a `main.{ts,js,py,go}` next to the TOML drives the run via
// defineRun({...}). Auto-detected from sibling files when [entry] omitted.
export const EntrySchema = Type.Object(
  {
    runtime: Type.Union([
      Type.Literal("bun"),
      Type.Literal("node"),
      Type.Literal("deno"),
      Type.Literal("python"),
      Type.Literal("go"),
    ]),
    file: Type.String({ minLength: 1 }),
    input_schema: Type.Optional(Type.String({ minLength: 1 })),
    output_schema: Type.Optional(Type.String({ minLength: 1 })),
  },
  STRICT,
);

export const GraderSchema = Type.Object(
  {
    rubric_text: Type.Optional(Type.String({ minLength: 1 })),
    rubric_file: Type.Optional(Type.String({ minLength: 1 })),
    model: Type.Optional(Type.String({ minLength: 1 })),
    max_iterations: Type.Integer({ minimum: 1, maximum: 20, default: 3 }),
    on_verdict: Type.Union(
      [Type.Literal("feedback"), Type.Literal("fail-only"), Type.Literal("advisory")],
      { default: "feedback" },
    ),
  },
  STRICT,
);

export const OutcomesSchema = Type.Object(
  {
    success: Type.Optional(Type.String({ minLength: 1 })),
    warning: Type.Optional(Type.String({ minLength: 1 })),
    error: Type.Optional(Type.String({ minLength: 1 })),
    warning_tools: Type.Array(Type.String(), { default: [] }),
    error_tools: Type.Array(Type.String(), { default: [] }),
    max_retries: Type.Integer({ minimum: 0, maximum: 10, default: 0 }),
    retry_backoff_ms: Type.Integer({ minimum: 0, default: 30_000 }),
    grader: Type.Optional(GraderSchema),
  },
  STRICT,
);

export const BlueprintRawSchema = Type.Object(
  {
    name: Type.String({ pattern: NAME_PATTERN }),
    version: Type.String({ pattern: SEMVER_PATTERN }),
    description: Type.String({ minLength: 1, maxLength: 500 }),
    author: Type.String({ pattern: NAME_PATTERN }),
    tags: Type.Array(Type.String(), { default: [] }),
    license: Type.String({ default: "MIT" }),
    schema_version: Type.Literal(1, { default: 1 }),

    /**
     * @deprecated since 0.0.x — set engine model roles instead. Kept as a
     * fallback for the "default" role; emits a warning when present.
     */
    model: Type.Optional(Type.String({ minLength: 1 })),
    /**
     * Required for agent-mode blueprints. Forbidden in script-mode (presence
     * of [entry] block or main.{ts,js,py,go} sibling). The script-mode
     * required/forbidden rule lives in the path-aware refinement pass.
     */
    prompt: Type.Optional(Type.String({ minLength: 1 })),
    /** Script-mode entry script. Optional; auto-detected when omitted. */
    entry: Type.Optional(EntrySchema),
    /** Required engine roles a deployment must have configured. */
    requires: Type.Optional(
      Type.Object(
        {
          roles: Type.Array(Type.String({ minLength: 1 }), { default: [] }),
        },
        STRICT,
      ),
    ),

    tools: Type.Array(
      Type.Union([
        Type.String(),
        Type.Object(
          {
            name: Type.String({ minLength: 1 }),
            // Optional + default so `tools = [{ name = "bash" }]` is accepted.
            // Ajv's useDefaults doesn't propagate into anyOf union arms reliably,
            // so we normalize at parse time (entry.confirm undefined → false).
            confirm: Type.Optional(Type.Boolean({ default: false })),
          },
          STRICT,
        ),
      ]),
      { default: [] },
    ),
    skills: Type.Array(Type.String(), { default: [] }),

    // Use raw patternProperties + additionalProperties:false so non-matching
    // keys are rejected (typebox's Type.Record-with-pattern only adds
    // patternProperties without strict-key enforcement).
    connectors: Type.Unsafe<Record<string, ConnectorRaw>>({
      type: "object",
      patternProperties: { [NAME_PATTERN]: ConnectorSchema },
      additionalProperties: false,
      default: {},
    }),
    scripts: Type.Unsafe<Record<string, string>>({
      type: "object",
      patternProperties: { [TOOL_NAME_PATTERN]: { type: "string", minLength: 1 } },
      additionalProperties: false,
      default: {},
    }),

    memory: Type.Optional(MemorySchema),
    secrets: Type.Record(Type.String(), Type.String(), { default: {} }),
    /**
     * Legacy. Default false (graceful). The new [outcomes] block supersedes
     * this with proper soft/hard error classification.
     */
    fail_on_tool_error: Type.Boolean({ default: false }),

    output_schema: Type.Optional(OutputSchemaSchema),
    input_schema: Type.Optional(InputSchemaSchema),
    outcomes: Type.Optional(OutcomesSchema),
  },
  STRICT,
);

export type BlueprintRaw = Static<typeof BlueprintRawSchema>;
export type ConnectorRaw = Static<typeof ConnectorSchema>;
export type ConnectorAuthRaw = Static<typeof ConnectorAuthSchema>;
export type EntryRaw = Static<typeof EntrySchema>;

// ---------------------------------------------------------------------------
// Script-mode detection + script-mode refinement.
// ---------------------------------------------------------------------------

/** Sibling file names that flip a blueprint into script mode when present. */
export const SCRIPT_MODE_SIBLINGS = ["main.ts", "main.js", "main.py", "main.go"] as const;

/**
 * Field names on a raw blueprint that imply agent-mode control flow and are
 * therefore forbidden in script mode. `prompt` is the canary — it's the only
 * required-in-agent-mode field. `outcomes` and `output_schema`/`input_schema`
 * are also agent-loop concerns; the script declares its own schemas via
 * defineRun({inputSchema, outputSchema}).
 *
 * `tools`, `skills`, `connectors`, `scripts` stay allowed because the script
 * may reach for them via ctx.tool / ctx.mcp / ctx.runAgent.
 */
const AGENT_MODE_FORBIDDEN_FIELDS = [
  "prompt",
  "outcomes",
  "output_schema",
  "input_schema",
] as const;

/**
 * Returns true if `raw.entry` is set OR a sibling main.{ts,js,py,go} exists
 * in `blueprintDir`. Caller supplies an `existsFn` so the schema layer stays
 * platform-agnostic; load.ts/parse.ts wires in node:fs.existsSync.
 */
export function detectScriptMode(
  raw: BlueprintRaw,
  blueprintDir: string | undefined,
  existsFn: (path: string) => boolean,
): boolean {
  if (raw.entry) return true;
  if (!blueprintDir) return false;
  for (const sibling of SCRIPT_MODE_SIBLINGS) {
    if (existsFn(`${blueprintDir}/${sibling}`)) return true;
  }
  return false;
}

/**
 * Script-mode cross-field rules. Run after Ajv + base refinements pass.
 *
 * In script mode: agent-control fields are forbidden — move them into
 * main.{ts,js,py,go} via defineRun({...}) and ctx.runAgent({...}).
 * In agent mode: `prompt` is required (the schema marks it Optional only so
 * script-mode blueprints validate; we re-require it here).
 */
export function validateScriptModeRefinements(
  raw: BlueprintRaw,
  scriptMode: boolean,
): BlueprintSchemaIssue[] {
  const issues: BlueprintSchemaIssue[] = [];
  if (scriptMode) {
    for (const field of AGENT_MODE_FORBIDDEN_FIELDS) {
      if ((raw as Record<string, unknown>)[field] !== undefined) {
        issues.push({
          path: field,
          message:
            `blueprint is in script mode (entry block or main.{ts,js,py,go} sibling); ` +
            `top-level agent field '${field}' is not allowed — move agent control flow ` +
            `into main.{ts,js,py,go} via ctx.runAgent({...}).`,
        });
      }
    }
  } else if (!raw.prompt) {
    issues.push({
      path: "prompt",
      message: "must have required property 'prompt'",
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Compiled validators + structural / cross-field validation.
// ---------------------------------------------------------------------------

const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: false });
addFormats(ajv);

const validateStructure: ValidateFunction = ajv.compile(BlueprintRawSchema);

export interface BlueprintSchemaIssue {
  path: string;
  message: string;
}

function pointerToPath(pointer: string): string {
  if (!pointer || pointer === "/") return "";
  return pointer
    .replace(/^\//, "")
    .split("/")
    .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"))
    .join(".");
}

function refineConnector(
  connectorName: string,
  connector: unknown,
  issues: BlueprintSchemaIssue[],
): void {
  if (!connector || typeof connector !== "object") return;
  const c = connector as Record<string, unknown>;
  const hasCommand = "command" in c && c.command !== undefined;
  const hasServer = "server" in c && c.server !== undefined;
  const base = `connectors.${connectorName}`;
  if (hasCommand && hasServer) {
    issues.push({
      path: base,
      message: "Connector must have exactly one of `server` (http/sse) or `command` (stdio)",
    });
  }
  if (!hasCommand && !hasServer) {
    issues.push({
      path: base,
      message: "Connector must have `server` (http/sse) or `command` (stdio)",
    });
  }
}

function refineSchemaSource(path: string, value: unknown, issues: BlueprintSchemaIssue[]): void {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  if (Boolean(v.json_schema) === Boolean(v.json_schema_file)) {
    issues.push({
      path,
      message: "specify exactly one of json_schema or json_schema_file",
    });
  }
}

function refineGrader(value: unknown, issues: BlueprintSchemaIssue[]): void {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  if (Boolean(v.rubric_text) === Boolean(v.rubric_file)) {
    issues.push({
      path: "outcomes.grader",
      message: "outcomes.grader: exactly one of rubric_text or rubric_file is required",
    });
  }
}

/**
 * Run cross-field XOR refinements after Ajv accepts the structural shape.
 * Returns an empty array on success; populated array on failure.
 */
export function validateBlueprintRefinements(raw: BlueprintRaw): BlueprintSchemaIssue[] {
  const issues: BlueprintSchemaIssue[] = [];

  if (raw.connectors) {
    for (const [name, c] of Object.entries(raw.connectors)) {
      refineConnector(name, c, issues);
    }
  }
  if (raw.input_schema) refineSchemaSource("input_schema", raw.input_schema, issues);
  if (raw.output_schema) refineSchemaSource("output_schema", raw.output_schema, issues);
  if (raw.outcomes?.grader) refineGrader(raw.outcomes.grader, issues);

  return issues;
}

export interface ValidateResult {
  ok: boolean;
  data?: BlueprintRaw;
  issues: BlueprintSchemaIssue[];
}

/**
 * Two-pass validate: Ajv structural check, then cross-field refines. Ajv
 * mutates `data` to apply defaults via `useDefaults: true`, so the returned
 * `data` is the populated object on success.
 */
export function validateBlueprintRaw(input: unknown): ValidateResult {
  // Clone to avoid mutating caller's input when Ajv applies defaults.
  const data = input && typeof input === "object" ? structuredClone(input) : input;
  const ok = validateStructure(data);
  if (!ok) {
    const issues: BlueprintSchemaIssue[] = (validateStructure.errors ?? []).map((e) => {
      // Ajv reports unknown-property errors with the offending key in
      // params.additionalProperty; surface it in the message so users get a
      // useful "Unrecognized key 'modelz'" instead of the generic Ajv text.
      const extra = (e.params as { additionalProperty?: string } | undefined)?.additionalProperty;
      const message = extra ? `Unrecognized key '${extra}'` : (e.message ?? "invalid");
      return { path: pointerToPath(e.instancePath), message };
    });
    return { ok: false, issues };
  }
  const refined = validateBlueprintRefinements(data as BlueprintRaw);
  if (refined.length > 0) {
    return { ok: false, issues: refined };
  }
  return { ok: true, data: data as BlueprintRaw, issues: [] };
}
