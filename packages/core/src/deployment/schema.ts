import { z } from "zod";

export const TriggerSchema = z.union([
  z.strictObject({
    type: z.literal("cron"),
    schedule: z.string().min(1),
    timezone: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal("webhook"),
    path: z.string().optional(),
    auth: z
      .union([
        z.literal("none"),
        z.strictObject({
          kind: z.literal("none"),
        }),
        z.strictObject({
          kind: z.literal("bearer"),
          secret_ref: z.string(),
        }),
        z.strictObject({
          kind: z.literal("hmac"),
          algorithm: z.literal("sha256").default("sha256"),
          secret_ref: z.string(),
          header: z.string().default("x-signature"),
        }),
      ])
      .default("none"),
  }),
  z.strictObject({
    type: z.literal("manual"),
  }),
  z.strictObject({
    type: z.literal("event"),
    source: z.string(),
    filter: z.string().optional(),
  }),
]);

const ChannelModeSchema = z.enum(["static", "dynamic"]).optional();

export const ChannelConfigSchema = z.union([
  z.strictObject({
    type: z.literal("console"),
    mode: ChannelModeSchema,
  }),
  z.strictObject({
    type: z.literal("slack"),
    mode: ChannelModeSchema,
    target: z.string(),
    webhook_url_secret_ref: z.string().optional(),
    bot_token_secret_ref: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal("email"),
    mode: ChannelModeSchema,
    to: z.union([z.string(), z.array(z.string())]),
    from: z.string().optional(),
    subject: z.string().optional(),
    smtp_url_secret_ref: z.string().optional(),
    resend_api_key_secret_ref: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal("webhook"),
    mode: ChannelModeSchema,
    url: z.string().url(),
    hmac_secret_ref: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
]);

export const LimitsSchema = z.strictObject({
  duration: z
    .string()
    .regex(/^\d+[smh]$/, "duration like 30s, 5m, 1h")
    .optional(),
  tool_calls: z.number().int().positive().optional(),
  budget: z.number().positive().optional(),
  warn_threshold_pct: z.number().int().min(1).max(100).default(80),
});

// Inline / override block under `[environment]` in deploy.toml. All fields
// optional — when no `environment = "<id>"` reference is given the inline
// block must carry enough to construct a full EnvironmentConfig.
const NetworkingOverrideSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("unrestricted") }),
  z.strictObject({
    type: z.literal("limited"),
    allowed_hosts: z.array(z.string().min(1)).default([]),
    allow_mcp_servers: z.boolean().optional(),
    allow_package_managers: z.boolean().optional(),
  }),
]);

const PackageManifestOverrideSchema = z.strictObject({
  apt: z.array(z.string()).optional(),
  cargo: z.array(z.string()).optional(),
  gem: z.array(z.string()).optional(),
  go: z.array(z.string()).optional(),
  npm: z.array(z.string()).optional(),
  pip: z.array(z.string()).optional(),
});

const ProviderRefOverrideSchema = z.strictObject({
  service: z.string().min(1),
  credential: z.string().min(1).optional(),
});

const ResourcesOverrideSchema = z.strictObject({
  cpu: z.number().positive().optional(),
  mem_mb: z.number().int().positive().optional(),
  disk_mb: z.number().int().positive().optional(),
});

export const EnvironmentInlineSchema = z.strictObject({
  type: z.enum(["cloud", "local"]).optional(),
  packages: PackageManifestOverrideSchema.optional(),
  networking: NetworkingOverrideSchema.optional(),
  image: z.string().min(1).optional(),
  working_dir: z.string().min(1).optional(),
  provider: ProviderRefOverrideSchema.optional(),
  resources: ResourcesOverrideSchema.optional(),
  template: z.string().min(1).optional(),
});

export const DeploymentRawSchema = z.strictObject({
  blueprint: z.string().min(1),
  name: z.string().optional(),
  trigger: z.array(TriggerSchema).default([]),
  channel: z.array(ChannelConfigSchema).default([]),
  limits: LimitsSchema.default({ warn_threshold_pct: 80 }),
  /** Reference to a stored environment by id. */
  environment: z.string().min(1).optional(),
  /** Inline override (or full inline body when `environment` is unset). */
  environment_inline: EnvironmentInlineSchema.optional(),
});

export type DeploymentRaw = z.infer<typeof DeploymentRawSchema>;
