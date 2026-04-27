import { defineCommand } from "citty";

import { api } from "../lib/api.ts";

const set = defineCommand({
  meta: { name: "set", description: "Pin a tag to a specific version." },
  args: {
    blueprint: { type: "positional", required: true, description: "Blueprint id (ns/name)" },
    tag: { type: "positional", required: true, description: "Tag name (e.g. stable, v1)" },
    version: { type: "positional", required: true, description: "Target version (e.g. 0.1.0)" },
  },
  async run({ args }) {
    await api.blueprints.setTag(args.blueprint, args.tag, args.version);
    process.stdout.write(`${args.blueprint}:${args.tag} -> ${args.version}\n`);
  },
});

const remove = defineCommand({
  meta: { name: "remove", description: "Remove a tag (cannot remove 'latest')." },
  args: {
    blueprint: { type: "positional", required: true, description: "Blueprint id (ns/name)" },
    tag: { type: "positional", required: true, description: "Tag name to remove" },
  },
  async run({ args }) {
    await api.blueprints.removeTag(args.blueprint, args.tag);
    process.stdout.write(`removed ${args.blueprint}:${args.tag}\n`);
  },
});

const list = defineCommand({
  meta: { name: "list", description: "List tags pointing at this blueprint." },
  args: {
    blueprint: { type: "positional", required: true, description: "Blueprint id (ns/name)" },
  },
  async run({ args }) {
    const r = await api.blueprints.listTags(args.blueprint);
    if (r.tags.length === 0) {
      process.stdout.write(`(no tags)\n`);
      return;
    }
    const width = Math.max(...r.tags.map((t) => t.tag.length));
    for (const t of r.tags) {
      process.stdout.write(`${t.tag.padEnd(width)}  ${t.version}\n`);
    }
  },
});

export default defineCommand({
  meta: { name: "tag", description: "Manage blueprint tags (Docker-style)." },
  subCommands: { set, remove, list },
});
