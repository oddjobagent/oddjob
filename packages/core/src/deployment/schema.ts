// Deployment TOML schema, expressed in typebox.

import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { type Static, Type } from "typebox";

const STRICT = { additionalProperties: false } as const;
const DURATION_PATTERN = "^\\d+[smh]$";

export const TriggerSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("cron"),
      schedule: Type.String({ minLength: 1 }),
      timezone: Type.Optional(Type.String()),
    },
    STRICT,
  ),
  Type.Object(
    {
      type: Type.Literal("webhook"),
      path: Type.Optional(Type.String()),
      auth: Type.Optional(
        Type.Union(
          [
            Type.Literal("none"),
            Type.Object({ kind: Type.Literal("none") }, STRICT),
            Type.Object(
              {
                kind: Type.Literal("bearer"),
                secret_ref: Type.String(),
              },
              STRICT,
            ),
            Type.Object(
              {
                kind: Type.Literal("hmac"),
                algorithm: Type.Optional(Type.Literal("sha256", { default: "sha256" })),
                secret_ref: Type.String(),
                header: Type.Optional(Type.String({ default: "x-signature" })),
              },
              STRICT,
            ),
          ],
          { default: "none" },
        ),
      ),
    },
    STRICT,
  ),
  Type.Object({ type: Type.Literal("manual") }, STRICT),
  Type.Object(
    {
      type: Type.Literal("event"),
      source: Type.String(),
      filter: Type.Optional(Type.String()),
    },
    STRICT,
  ),
]);

const ChannelModeSchema = Type.Optional(
  Type.Union([Type.Literal("static"), Type.Literal("dynamic")]),
);

export const ChannelConfigSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("console"),
      mode: ChannelModeSchema,
    },
    STRICT,
  ),
  Type.Object(
    {
      type: Type.Literal("slack"),
      mode: ChannelModeSchema,
      target: Type.String(),
      webhook_url_secret_ref: Type.Optional(Type.String()),
      bot_token_secret_ref: Type.Optional(Type.String()),
    },
    STRICT,
  ),
  Type.Object(
    {
      type: Type.Literal("email"),
      mode: ChannelModeSchema,
      to: Type.Union([Type.String(), Type.Array(Type.String())]),
      from: Type.Optional(Type.String()),
      subject: Type.Optional(Type.String()),
      smtp_url_secret_ref: Type.Optional(Type.String()),
      resend_api_key_secret_ref: Type.Optional(Type.String()),
    },
    STRICT,
  ),
  Type.Object(
    {
      type: Type.Literal("webhook"),
      mode: ChannelModeSchema,
      url: Type.String({ format: "uri" }),
      hmac_secret_ref: Type.Optional(Type.String()),
      headers: Type.Optional(Type.Record(Type.String(), Type.String())),
    },
    STRICT,
  ),
]);

export const LimitsSchema = Type.Object(
  {
    duration: Type.Optional(Type.String({ pattern: DURATION_PATTERN })),
    tool_calls: Type.Optional(Type.Integer({ minimum: 1 })),
    budget: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    warn_threshold_pct: Type.Integer({ minimum: 1, maximum: 100, default: 80 }),
    enforce: Type.Boolean({ default: false }),
  },
  STRICT,
);

// Inline / override block under `[environment]` in deploy.toml. All fields
// optional — when no `environment = "<id>"` reference is given the inline
// block must carry enough to construct a full EnvironmentConfig.
const NetworkingOverrideSchema = Type.Union([
  Type.Object({ type: Type.Literal("unrestricted") }, STRICT),
  Type.Object(
    {
      type: Type.Literal("limited"),
      allowed_hosts: Type.Array(Type.String({ minLength: 1 }), { default: [] }),
      allow_mcp_servers: Type.Optional(Type.Boolean()),
      allow_package_managers: Type.Optional(Type.Boolean()),
    },
    STRICT,
  ),
]);

const PackageManifestOverrideSchema = Type.Object(
  {
    apt: Type.Optional(Type.Array(Type.String())),
    cargo: Type.Optional(Type.Array(Type.String())),
    gem: Type.Optional(Type.Array(Type.String())),
    go: Type.Optional(Type.Array(Type.String())),
    npm: Type.Optional(Type.Array(Type.String())),
    pip: Type.Optional(Type.Array(Type.String())),
  },
  STRICT,
);

const ProviderRefOverrideSchema = Type.Object(
  {
    service: Type.Optional(Type.String({ minLength: 1 })),
    credential: Type.Optional(Type.String({ minLength: 1 })),
  },
  STRICT,
);

const ResourcesOverrideSchema = Type.Object(
  {
    cpu: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    mem_mb: Type.Optional(Type.Integer({ minimum: 1 })),
    disk_mb: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  STRICT,
);

export const EnvironmentInlineSchema = Type.Object(
  {
    type: Type.Optional(Type.Union([Type.Literal("cloud"), Type.Literal("local")])),
    packages: Type.Optional(PackageManifestOverrideSchema),
    networking: Type.Optional(NetworkingOverrideSchema),
    image: Type.Optional(Type.String({ minLength: 1 })),
    working_dir: Type.Optional(Type.String({ minLength: 1 })),
    provider: Type.Optional(ProviderRefOverrideSchema),
    resources: Type.Optional(ResourcesOverrideSchema),
    template: Type.Optional(Type.String({ minLength: 1 })),
  },
  STRICT,
);

export const DeploymentRawSchema = Type.Object(
  {
    blueprint: Type.String({ minLength: 1 }),
    name: Type.Optional(Type.String()),
    trigger: Type.Array(TriggerSchema, { default: [] }),
    channel: Type.Array(ChannelConfigSchema, { default: [] }),
    limits: Type.Optional(LimitsSchema),
    /** Reference to a stored environment by id. */
    environment: Type.Optional(Type.String({ minLength: 1 })),
    /** Inline override (or full inline body when `environment` is unset). */
    environment_inline: Type.Optional(EnvironmentInlineSchema),
  },
  STRICT,
);

export type DeploymentRaw = Static<typeof DeploymentRawSchema>;

// ---------------------------------------------------------------------------
// Compiled validator.
// ---------------------------------------------------------------------------

const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: false });
addFormats(ajv);

const validateStructure: ValidateFunction = ajv.compile(DeploymentRawSchema);

export interface DeploymentSchemaIssue {
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

export interface ValidateDeploymentResult {
  ok: boolean;
  data?: DeploymentRaw;
  issues: DeploymentSchemaIssue[];
}

export function validateDeploymentRaw(input: unknown): ValidateDeploymentResult {
  const data = input && typeof input === "object" ? structuredClone(input) : input;
  const ok = validateStructure(data);
  if (!ok) {
    const issues: DeploymentSchemaIssue[] = (validateStructure.errors ?? []).map((e) => {
      const extra = (e.params as { additionalProperty?: string } | undefined)?.additionalProperty;
      const message = extra ? `Unrecognized key '${extra}'` : (e.message ?? "invalid");
      return { path: pointerToPath(e.instancePath), message };
    });
    return { ok: false, issues };
  }
  return { ok: true, data: data as DeploymentRaw, issues: [] };
}
