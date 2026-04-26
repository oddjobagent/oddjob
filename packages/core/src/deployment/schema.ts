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

export const ChannelConfigSchema = z.union([
  z.strictObject({
    type: z.literal("console"),
  }),
  z.strictObject({
    type: z.literal("slack"),
    target: z.string(),
    webhook_url_secret_ref: z.string().optional(),
    bot_token_secret_ref: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal("email"),
    to: z.union([z.string(), z.array(z.string())]),
    from: z.string().optional(),
    smtp_url_secret_ref: z.string().optional(),
    resend_api_key_secret_ref: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal("webhook"),
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

export const DeploymentRawSchema = z.strictObject({
  blueprint: z.string().min(1),
  name: z.string().optional(),
  trigger: z.array(TriggerSchema).default([]),
  channel: z.array(ChannelConfigSchema).default([]),
  limits: LimitsSchema.default({ warn_threshold_pct: 80 }),
});

export type DeploymentRaw = z.infer<typeof DeploymentRawSchema>;
