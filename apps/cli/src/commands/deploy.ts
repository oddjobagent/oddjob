import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { defineCommand } from "citty";

import { loadBlueprint, parseDeployment } from "@oddjob/core";

import { api } from "../lib/api.ts";

export default defineCommand({
  meta: { name: "deploy", description: "Create a deployment from a blueprint dir." },
  args: {
    path: { type: "positional", required: false, default: ".", description: "Blueprint dir" },
    name: { type: "string", description: "Deployment name (defaults to blueprint name)" },
  },
  async run({ args }) {
    const bp = await loadBlueprint(args.path, { validate: true, checkFs: true });
    const deployFile = resolve(args.path, "deploy.toml");
    let depInput;
    try {
      const src = await readFile(deployFile, "utf8");
      depInput = parseDeployment(src, {
        defaultName: args.name ?? bp.name,
        blueprintId: bp.id,
      });
    } catch {
      depInput = {
        name: args.name ?? bp.name,
        blueprintId: bp.id,
        triggers: [{ type: "manual" as const }],
        channels: [{ type: "console" as const }],
        limits: { warnThresholdPct: 80 },
      };
    }
    const d = await api.deployments.create(depInput);
    process.stdout.write(`deployed ${d.name} (${d.id})\n`);
    process.stdout.write(`triggers: ${d.triggers.map((t) => t.type).join(", ")}\n`);
    process.stdout.write(`channels: ${d.channels.map((c) => c.type).join(", ")}\n`);
  },
});
