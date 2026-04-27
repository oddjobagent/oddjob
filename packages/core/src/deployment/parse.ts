import { parse as parseToml } from "smol-toml";

import { BlueprintParseError } from "../blueprint/errors.ts";
import type { ChannelConfig } from "../types/channel.ts";
import type { DeploymentInput } from "../types/deployment.ts";
import type { Limits } from "../types/limits.ts";
import type { Trigger, WebhookAuth } from "../types/trigger.ts";
import { type DeploymentRaw, DeploymentRawSchema } from "./schema.ts";

export interface ParseDeploymentOptions {
  defaultName: string;
  blueprintId: `${string}/${string}`;
  expectedBlueprintField?: string;
}

export function parseDeployment(source: string, options: ParseDeploymentOptions): DeploymentInput {
  let toml: unknown;
  try {
    toml = parseToml(source);
  } catch (err) {
    throw new BlueprintParseError(`Failed to parse deploy.toml: ${(err as Error).message}`, err);
  }

  const result = DeploymentRawSchema.safeParse(toml);
  if (!result.success) {
    throw new BlueprintParseError(
      `deploy.toml schema invalid:\n${result.error.issues
        .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n")}`,
      result.error,
    );
  }

  if (
    options.expectedBlueprintField !== undefined &&
    result.data.blueprint !== options.expectedBlueprintField
  ) {
    throw new BlueprintParseError(
      `deploy.toml blueprint = "${result.data.blueprint}" does not match expected "${options.expectedBlueprintField}"`,
    );
  }

  return normalizeDeployment(result.data, options);
}

function normalizeDeployment(raw: DeploymentRaw, options: ParseDeploymentOptions): DeploymentInput {
  const triggers: Trigger[] = raw.trigger.map(normalizeTrigger);
  const channels: ChannelConfig[] = raw.channel.map(normalizeChannel);
  const limits: Partial<Limits> = {
    durationMs: raw.limits.duration ? parseDuration(raw.limits.duration) : undefined,
    toolCalls: raw.limits.tool_calls,
    budgetUsd: raw.limits.budget,
    warnThresholdPct: raw.limits.warn_threshold_pct,
  };

  return {
    name: raw.name ?? options.defaultName,
    blueprintId: options.blueprintId,
    triggers,
    channels,
    limits,
  };
}

function normalizeTrigger(raw: DeploymentRaw["trigger"][number]): Trigger {
  switch (raw.type) {
    case "cron":
      return { type: "cron", schedule: raw.schedule, timezone: raw.timezone };
    case "manual":
      return { type: "manual" };
    case "event":
      return { type: "event", source: raw.source, filter: raw.filter };
    case "webhook":
      return {
        type: "webhook",
        path: raw.path,
        auth: normalizeWebhookAuth(raw.auth),
      };
  }
}

type WebhookAuthRaw =
  | "none"
  | "bearer"
  | { kind: "none" }
  | { kind: "bearer"; secret_ref: string }
  | { kind: "hmac"; algorithm: "sha256"; secret_ref: string; header: string };

function normalizeWebhookAuth(raw: WebhookAuthRaw): WebhookAuth {
  if (raw === "none") return { kind: "none" };
  if (raw === "bearer") {
    throw new BlueprintParseError(
      'webhook auth = "bearer" requires a secret_ref. Use { kind = "bearer", secret_ref = "..." }',
    );
  }
  switch (raw.kind) {
    case "none":
      return { kind: "none" };
    case "bearer":
      return { kind: "bearer", secretRef: raw.secret_ref };
    case "hmac":
      return {
        kind: "hmac",
        algorithm: raw.algorithm,
        secretRef: raw.secret_ref,
        header: raw.header,
      };
  }
}

function normalizeChannel(raw: DeploymentRaw["channel"][number]): ChannelConfig {
  switch (raw.type) {
    case "console":
      return { type: "console", mode: raw.mode };
    case "slack":
      return {
        type: "slack",
        mode: raw.mode,
        target: raw.target,
        webhookUrlSecretRef: raw.webhook_url_secret_ref,
        botTokenSecretRef: raw.bot_token_secret_ref,
      };
    case "email":
      return {
        type: "email",
        mode: raw.mode,
        to: raw.to,
        from: raw.from,
        subject: raw.subject,
        smtpUrlSecretRef: raw.smtp_url_secret_ref,
        resendApiKeySecretRef: raw.resend_api_key_secret_ref,
      };
    case "webhook":
      return {
        type: "webhook",
        mode: raw.mode,
        url: raw.url,
        hmacSecretRef: raw.hmac_secret_ref,
        headers: raw.headers,
      };
  }
}

function parseDuration(d: string): number {
  const match = d.match(/^(\d+)([smh])$/);
  if (!match) throw new BlueprintParseError(`invalid duration: ${d}`);
  const n = Number(match[1]);
  const unit = match[2];
  switch (unit) {
    case "s":
      return n * 1000;
    case "m":
      return n * 60 * 1000;
    case "h":
      return n * 60 * 60 * 1000;
    default:
      throw new BlueprintParseError(`invalid duration unit: ${unit}`);
  }
}
