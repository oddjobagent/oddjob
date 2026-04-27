import { defineCommand } from "citty";

import type { ChannelConfig } from "@oddjob/core";

import { api } from "../lib/api.ts";

const list = defineCommand({
  meta: { name: "list", description: "List channels on a deployment." },
  args: {
    deployment: { type: "positional", required: true, description: "Deployment id or name" },
  },
  async run({ args }) {
    const dep = await resolveDeployment(args.deployment);
    if (dep.channels.length === 0) {
      process.stdout.write("(no channels)\n");
      return;
    }
    for (const c of dep.channels) process.stdout.write(`${describe(c)}\n`);
  },
});

const add = defineCommand({
  meta: { name: "add", description: "Add a channel to a deployment." },
  args: {
    deployment: { type: "positional", required: true, description: "Deployment id or name" },
    type: { type: "positional", required: true, description: "console|slack|email|webhook" },
    target: { type: "string", description: "Channel-specific destination" },
    secretRef: { type: "string", description: "Name of secret holding api key / webhook url" },
  },
  async run({ args }) {
    const dep = await resolveDeployment(args.deployment);
    const ch = buildChannel(args.type, args.target, args.secretRef);
    const channels = [...dep.channels, ch];
    await api.deployments.update(dep.id, { channels });
    process.stdout.write(`added ${args.type} channel\n`);
  },
});

const remove = defineCommand({
  meta: { name: "remove", description: "Remove a channel by index (0-based)." },
  args: {
    deployment: { type: "positional", required: true, description: "Deployment id or name" },
    index: { type: "positional", required: true, description: "0-based index" },
  },
  async run({ args }) {
    const dep = await resolveDeployment(args.deployment);
    const i = Number(args.index);
    if (Number.isNaN(i) || i < 0 || i >= dep.channels.length) {
      throw new Error(`index out of range: ${args.index}`);
    }
    const channels = dep.channels.filter((_, idx) => idx !== i);
    await api.deployments.update(dep.id, { channels });
    process.stdout.write(`removed channel ${i}\n`);
  },
});

export default defineCommand({
  meta: { name: "channel", description: "Manage channels on deployments." },
  subCommands: {
    list: () => Promise.resolve(list),
    add: () => Promise.resolve(add),
    remove: () => Promise.resolve(remove),
  },
});

async function resolveDeployment(target: string) {
  const list = await api.deployments.list({ includeArchived: true });
  const dep = list.deployments.find((d) => d.id === target || d.name === target);
  if (!dep) throw new Error(`deployment '${target}' not found`);
  return dep;
}

function describe(c: ChannelConfig): string {
  if (c.type === "console") return "console";
  if (c.type === "slack") return `slack target=${c.target}`;
  if (c.type === "email") return `email to=${String(c.to)}`;
  if (c.type === "webhook") return `webhook url=${c.url}`;
  return c.type;
}

function buildChannel(
  type: string,
  target: string | undefined,
  secretRef: string | undefined,
): ChannelConfig {
  if (type === "console") return { type: "console" };
  if (type === "slack") {
    if (!target) throw new Error("--target required for slack");
    return { type: "slack", target, webhookUrlSecretRef: secretRef };
  }
  if (type === "email") {
    if (!target) throw new Error("--target required for email (recipient address)");
    return { type: "email", to: target, resendApiKeySecretRef: secretRef };
  }
  if (type === "webhook") {
    if (!target) throw new Error("--target required for webhook (url)");
    return { type: "webhook", url: target, hmacSecretRef: secretRef };
  }
  throw new Error(`unknown channel type: ${type}`);
}
