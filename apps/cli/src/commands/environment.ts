import { readFile } from "node:fs/promises";

import { defineCommand } from "citty";

import { api } from "../lib/api.ts";

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

export default defineCommand({
  meta: { name: "environment", description: "Manage container environments." },
  subCommands: { list, inspect, push, remove },
});
