import { defineCommand } from "citty";

import { api } from "../lib/api.ts";

export default defineCommand({
  meta: {
    name: "undeploy",
    description: "Archive a deployment (soft delete — history preserved).",
  },
  args: {
    name: {
      type: "positional",
      required: true,
      description: "Deployment name or ID",
    },
  },
  async run({ args }) {
    const list = await api.deployments.list({ includeArchived: true });
    const target = list.deployments.find((d) => d.id === args.name || d.name === args.name);
    if (!target) {
      throw new Error(`deployment '${args.name}' not found`);
    }
    if (target.status === "archived") {
      process.stdout.write(`already archived: ${target.name}\n`);
      return;
    }
    const updated = await api.deployments.archive(target.id);
    process.stdout.write(`archived ${updated.name} (${updated.id})\n`);
  },
});
