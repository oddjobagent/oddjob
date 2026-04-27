import { z } from "zod";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const TOOL_NAME_PATTERN = /^[a-z0-9][a-z0-9_]*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/;

export const ConnectorAuthSchema = z.union([
  z.literal("none"),
  z.literal("api_key"),
  z.literal("bearer"),
  z.literal("oauth2"),
  z.strictObject({
    kind: z.literal("none"),
  }),
  z.strictObject({
    kind: z.literal("api_key"),
    header_name: z.string().optional(),
    secret_ref: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("bearer"),
    secret_ref: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("oauth2"),
    client_id_ref: z.string().optional(),
    client_secret_ref: z.string().optional(),
    authorization_url: z.string().url().optional(),
    token_url: z.string().url().optional(),
    scopes: z.array(z.string()).optional(),
    use_pkce: z.boolean().optional(),
  }),
]);

export const StdioConnectorSchema = z.strictObject({
  transport: z.literal("stdio").optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  auth: ConnectorAuthSchema.optional(),
  scopes: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const HttpConnectorSchema = z.strictObject({
  transport: z.enum(["http", "sse"]).default("http"),
  server: z.string().url(),
  auth: ConnectorAuthSchema.optional(),
  scopes: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const ConnectorSchema = z
  .union([StdioConnectorSchema, HttpConnectorSchema])
  .superRefine((c, ctx) => {
    const hasCommand = "command" in c && c.command !== undefined;
    const hasServer = "server" in c && c.server !== undefined;
    if (hasCommand && hasServer) {
      ctx.addIssue({
        code: "custom",
        message: "Connector must have exactly one of `server` (http/sse) or `command` (stdio)",
      });
    }
    if (!hasCommand && !hasServer) {
      ctx.addIssue({
        code: "custom",
        message: "Connector must have `server` (http/sse) or `command` (stdio)",
      });
    }
  });

export const MemorySchema = z.strictObject({
  store: z.enum(["kv", "vector", "both"]).default("kv"),
  retention: z
    .string()
    .regex(/^\d+[smhdw]$/, "retention must be like 30d, 12h, 60m, 30s, 4w")
    .default("30d"),
});

const SchemaSourceSchema = z
  .strictObject({
    json_schema: z.union([z.record(z.string(), z.unknown()), z.string()]).optional(),
    json_schema_file: z.string().min(1).optional(),
  })
  .refine(
    (v) => Boolean(v.json_schema) !== Boolean(v.json_schema_file),
    "specify exactly one of json_schema or json_schema_file",
  );

export const OutputSchemaSchema = SchemaSourceSchema;
export const InputSchemaSchema = SchemaSourceSchema;

export const OutcomesSchema = z.strictObject({
  success: z.string().min(1).optional(),
  warning: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  warning_tools: z.array(z.string()).default([]),
  error_tools: z.array(z.string()).default([]),
  max_retries: z.number().int().min(0).max(10).default(0),
  retry_backoff_ms: z.number().int().min(0).default(30_000),
});

export const BlueprintRawSchema = z.strictObject({
  name: z.string().regex(NAME_PATTERN, "name must be lowercase letters, digits, and hyphens"),
  version: z.string().regex(SEMVER_PATTERN, "version must be semver"),
  description: z.string().min(1).max(500),
  author: z.string().regex(NAME_PATTERN, "author must be lowercase letters, digits, and hyphens"),
  tags: z.array(z.string()).default([]),
  license: z.string().default("MIT"),
  schema_version: z.literal(1).default(1),

  model: z.string().min(1),
  prompt: z.string().min(1),

  tools: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),

  connectors: z.record(z.string().regex(NAME_PATTERN), ConnectorSchema).default({}),
  scripts: z.record(z.string().regex(TOOL_NAME_PATTERN), z.string().min(1)).default({}),

  memory: MemorySchema.default({ store: "kv", retention: "30d" }),
  secrets: z.record(z.string(), z.string()).default({}),
  // Legacy. Default false (graceful). The new [outcomes] block supersedes
  // this with proper soft/hard error classification.
  fail_on_tool_error: z.boolean().default(false),

  output_schema: OutputSchemaSchema.optional(),
  input_schema: InputSchemaSchema.optional(),
  outcomes: OutcomesSchema.optional(),
});

export type BlueprintRaw = z.infer<typeof BlueprintRawSchema>;
export type ConnectorRaw = z.infer<typeof ConnectorSchema>;
export type ConnectorAuthRaw = z.infer<typeof ConnectorAuthSchema>;
