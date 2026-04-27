import { readFile } from "node:fs/promises";

import { defineCommand } from "citty";

import { api, rawFetch } from "../lib/api.ts";

const list = defineCommand({
  meta: { name: "list", description: "List configured environments." },
  async run() {
    const r = await api.environments.list();
    if (r.environments.length === 0) {
      process.stdout.write("(no environments)\n");
      return;
    }
    for (const e of r.environments) {
      process.stdout.write(
        `${e.id.padEnd(28)}  ${e.config.type.padEnd(6)}  ${e.description ?? ""}\n`,
      );
    }
  },
});

const inspect = defineCommand({
  meta: { name: "inspect", description: "Show one environment." },
  args: { id: { type: "positional", required: true, description: "Environment id" } },
  async run({ args }) {
    const env = await api.environments.get(args.id);
    process.stdout.write(JSON.stringify(env, null, 2) + "\n");
  },
});

const push = defineCommand({
  meta: { name: "push", description: "Upsert an environment from a TOML file." },
  args: {
    file: { type: "positional", required: true, description: "Path to environment.toml" },
  },
  async run({ args }) {
    const toml = await readFile(args.file, "utf8");
    const env = await api.environments.upsert({ toml });
    process.stdout.write(`pushed environment ${env.id}\n`);
  },
});

const remove = defineCommand({
  meta: { name: "remove", description: "Delete an environment." },
  args: { id: { type: "positional", required: true, description: "Environment id" } },
  async run({ args }) {
    await api.environments.remove(args.id);
    process.stdout.write(`removed ${args.id}\n`);
  },
});

const providers = defineCommand({
  meta: {
    name: "providers",
    description: "List registered EnvironmentService providers + availability.",
  },
  async run() {
    const r = await rawFetch("/api/v1/environments/providers");
    const body = (await r.json()) as {
      providers: Array<{
        id: string;
        displayName: string;
        trustTier: string;
        authHint?: string;
        capabilities: { snapshot: boolean; exposePort: boolean; packageManagers: string[] };
        available: { ok: boolean; reason?: string };
      }>;
    };
    if (body.providers.length === 0) {
      process.stdout.write("(no environment providers registered)\n");
      return;
    }
    for (const p of body.providers) {
      const status = p.available.ok ? "ok" : `unavailable: ${p.available.reason ?? "?"}`;
      process.stdout.write(
        `${p.id.padEnd(14)}  ${p.trustTier.padEnd(13)}  ${status.padEnd(40)}  ${p.displayName}\n`,
      );
    }
  },
});

const setDefault = defineCommand({
  meta: { name: "set-default", description: "Set the engine's default environment id." },
  args: {
    id: { type: "positional", required: true, description: "Environment id (or '' to clear)" },
  },
  async run({ args }) {
    const r = await rawFetch("/api/v1/engine", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultEnvironmentId: args.id || null }),
    });
    if (!r.ok) {
      const text = await r.text();
      process.stderr.write(`failed: ${r.status} ${text}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      args.id ? `engine default set to: ${args.id}\n` : "engine default cleared\n",
    );
  },
});

const credentialAdd = defineCommand({
  meta: {
    name: "add",
    description: "Add a provider credential for an environment service (e.g. daytona).",
  },
  args: {
    service: { type: "positional", required: true, description: "EnvironmentService id" },
    name: { type: "string", description: "Credential name", default: "default" },
    "api-key": { type: "string", description: "API key (stored as a secret)", required: true },
  },
  async run({ args }) {
    const credName = (args.name as string | undefined) ?? "default";
    const apiKey = args["api-key"] as string;
    const secretName = `ENV_${args.service.toUpperCase()}_${credName.toUpperCase()}_API_KEY`;
    const setSecret = await rawFetch(`/api/v1/secrets/${secretName}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: apiKey }),
    });
    if (!setSecret.ok) {
      process.stderr.write(
        `failed to store secret: ${setSecret.status} ${await setSecret.text()}\n`,
      );
      process.exitCode = 1;
      return;
    }
    const upsert = await rawFetch(`/api/v1/providers/${args.service}/credentials`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        credentialName: credName,
        apiKeySecret: secretName,
      }),
    });
    if (!upsert.ok) {
      process.stderr.write(
        `failed to upsert credential: ${upsert.status} ${await upsert.text()}\n`,
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`credential ${args.service}/${credName} added\n`);
  },
});

const credential = defineCommand({
  meta: { name: "credential", description: "Manage environment-service credentials." },
  subCommands: { add: credentialAdd },
});

export default defineCommand({
  meta: { name: "environment", description: "Manage container environments." },
  subCommands: { list, inspect, push, remove, providers, "set-default": setDefault, credential },
});
