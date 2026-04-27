import { defineCommand } from "citty";

import { api } from "../lib/api.ts";

export default defineCommand({
  meta: { name: "inspect", description: "Pretty-print a blueprint or deployment." },
  args: {
    target: { type: "positional", required: true, description: "<namespace>/<name> or deployment id/name" },
    json: { type: "boolean", description: "Emit raw JSON" },
  },
  async run({ args }) {
    const isBlueprint = args.target.includes("/");
    if (isBlueprint) {
      const bp = await api.blueprints.get(args.target);
      if (args.json) {
        process.stdout.write(`${JSON.stringify(bp, null, 2)}\n`);
        return;
      }
      process.stdout.write(`Blueprint: ${bp.id}\n`);
      process.stdout.write(`  version:  ${bp.version}\n`);
      process.stdout.write(`  model:    ${bp.model}\n`);
      process.stdout.write(`  hash:     ${bp.contentHash.slice(0, 12)}\n`);
      process.stdout.write(`  desc:     ${bp.description}\n`);
      process.stdout.write(`  tools:    ${bp.tools.join(", ") || "—"}\n`);
      process.stdout.write(`  skills:   ${bp.skills.join(", ") || "—"}\n`);
      process.stdout.write(
        `  connectors: ${Object.keys(bp.connectors).join(", ") || "—"}\n`,
      );
      process.stdout.write(`  scripts:    ${Object.keys(bp.scripts).join(", ") || "—"}\n`);
      return;
    }
    const list = await api.deployments.list({ includeArchived: true });
    const dep = list.deployments.find((d) => d.id === args.target || d.name === args.target);
    if (!dep) throw new Error(`deployment '${args.target}' not found`);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(dep, null, 2)}\n`);
      return;
    }
    process.stdout.write(`Deployment: ${dep.name} (${dep.id})\n`);
    process.stdout.write(`  blueprint:  ${dep.blueprintId}\n`);
    process.stdout.write(`  status:     ${dep.status}\n`);
    process.stdout.write(`  model:      ${dep.modelOverride ?? "(blueprint default)"}\n`);
    process.stdout.write(`  budget:     ${dep.limits.budgetUsd ?? "—"}\n`);
    process.stdout.write(`  triggers:   ${dep.triggers.map((t) => t.type).join(", ") || "—"}\n`);
    process.stdout.write(`  channels:   ${dep.channels.map((c) => c.type).join(", ") || "—"}\n`);
  },
});
