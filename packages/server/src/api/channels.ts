import type { ChannelConfig, ChannelTemplate } from "@oddjob/core";

import type { Runtime } from "../runtime.ts";
import {
  type Handler,
  badRequest,
  json,
  notFound,
  readJson,
  serverError,
} from "../middleware/index.ts";

interface FieldDescriptor {
  name: string;
  label: string;
  kind: "string" | "secretRef" | "stringList" | "headers";
  required: boolean;
  helper?: string;
}

interface TypeDescriptor {
  type: string;
  label: string;
  description: string;
  fields: FieldDescriptor[];
}

const TYPES: TypeDescriptor[] = [
  {
    type: "console",
    label: "Console",
    description: "Print run output to the server's stdout. Always available.",
    fields: [],
  },
  {
    type: "slack",
    label: "Slack",
    description: "Post run output to a Slack channel via incoming webhook or bot token.",
    fields: [
      { name: "target", label: "Channel or user", kind: "string", required: true, helper: "#alerts or @user" },
      { name: "webhookUrlSecretRef", label: "Webhook URL secret", kind: "secretRef", required: false },
      { name: "botTokenSecretRef", label: "Bot token secret", kind: "secretRef", required: false },
    ],
  },
  {
    type: "email",
    label: "Email",
    description: "Send run output via Resend (SMTP coming later).",
    fields: [
      { name: "to", label: "Recipient(s)", kind: "string", required: true, helper: "comma-separated; supports {{input.email}}" },
      { name: "from", label: "From", kind: "string", required: false },
      { name: "subject", label: "Subject", kind: "string", required: false, helper: "supports {{...}} templates" },
      { name: "resendApiKeySecretRef", label: "Resend API key secret", kind: "secretRef", required: false },
    ],
  },
  {
    type: "webhook",
    label: "Webhook",
    description: "POST run output as JSON to a URL. Optional HMAC-SHA256 signature.",
    fields: [
      { name: "url", label: "URL", kind: "string", required: true, helper: "supports {{input.callback}}" },
      { name: "hmacSecretRef", label: "HMAC secret name", kind: "secretRef", required: false },
      { name: "headers", label: "Extra headers", kind: "headers", required: false },
    ],
  },
];

export const types = (): Handler => () => json({ types: TYPES });

interface TestBody {
  config: ChannelConfig;
  message?: string;
}

export const test =
  (rt: Runtime): Handler =>
  async (req) => {
    const body = await readJson<TestBody>(req);
    if (!body || !body.config) return badRequest("body must include { config }");
    const cfg = body.config;
    if (!cfg.type) return badRequest("config.type required");

    // Verify any referenced secrets are present so the user gets a clear
    // error instead of a downstream fetch failure.
    const missing = await missingSecretRefs(rt, cfg);
    if (missing.length > 0) {
      return badRequest(`missing secrets: ${missing.join(", ")}`);
    }

    const provider = rt.channelFor(cfg.type);
    if (!provider) return badRequest(`unknown channel type: ${cfg.type}`);

    const stamp = new Date().toISOString();
    const message = body.message ?? `Oddjob test message — ${stamp}`;
    try {
      await provider.send({
        body: message,
        format: "text",
        meta: { test: true, channelConfig: cfg },
      });
      return json({ ok: true, sentAt: stamp });
    } catch (err) {
      return serverError(err);
    }
  };

// ── Channel templates (saved presets) ──────────────────────────────────

interface TemplateInput {
  name: string;
  config: ChannelConfig;
  description?: string;
}

export const listTemplates =
  (rt: Runtime): Handler =>
  async () => {
    const list = await rt.state.listChannelTemplates();
    return json({ templates: list });
  };

export const upsertTemplate =
  (rt: Runtime): Handler =>
  async (req) => {
    const body = await readJson<TemplateInput>(req);
    if (!body || !body.name || !body.config) {
      return badRequest("body must include name + config");
    }
    if (!body.config.type) return badRequest("config.type required");
    const now = Date.now();
    const existing = await rt.state.getChannelTemplate(body.name);
    const template: ChannelTemplate = {
      name: body.name,
      type: body.config.type,
      config: body.config,
      description: body.description,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await rt.state.upsertChannelTemplate(template);
    return json({ template }, { status: existing ? 200 : 201 });
  };

export const getTemplate =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const t = await rt.state.getChannelTemplate(ctx.params.name ?? "");
    if (!t) return notFound("template not found");
    return json({ template: t });
  };

export const deleteTemplate =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    const name = ctx.params.name ?? "";
    const t = await rt.state.getChannelTemplate(name);
    if (!t) return notFound("template not found");
    // Templates are convenience presets — channel configs were copied onto each
    // deployment at create time, so deleting a template doesn't break existing
    // deployments. No in-use check needed.
    await rt.state.deleteChannelTemplate(name);
    return new Response(null, { status: 204 });
  };

async function missingSecretRefs(rt: Runtime, cfg: ChannelConfig): Promise<string[]> {
  const refs: string[] = [];
  if (cfg.type === "slack") {
    if (cfg.webhookUrlSecretRef) refs.push(cfg.webhookUrlSecretRef);
    if (cfg.botTokenSecretRef) refs.push(cfg.botTokenSecretRef);
  }
  if (cfg.type === "email" && cfg.resendApiKeySecretRef) refs.push(cfg.resendApiKeySecretRef);
  if (cfg.type === "webhook" && cfg.hmacSecretRef) refs.push(cfg.hmacSecretRef);
  if (refs.length === 0) return [];
  const present = new Set(await rt.secrets.list());
  return refs.filter((r) => !present.has(r));
}
