import { defineCommand } from "citty";

import { api } from "../lib/api.ts";

export default defineCommand({
  meta: { name: "list", description: "List runs/deployments/blueprints." },
  args: {
    what: { type: "positional", required: true, description: "runs | deployments | blueprints" },
    deployment: { type: "string", description: "Filter runs by deployment id" },
    limit: { type: "string", default: "20", description: "Max rows" },
  },
  async run({ args }) {
    switch (args.what) {
      case "runs": {
        const r = await api.runs.list({
          deploymentId: args.deployment,
          limit: Number(args.limit),
        });
        for (const run of r.runs) {
          process.stdout.write(
            `${run.id}  ${run.status.padEnd(10)}  ${run.triggeredBy.padEnd(8)}  $${(run.costUsd ?? 0).toFixed(4)}  ${new Date(run.createdAt).toISOString()}\n`,
          );
        }
        break;
      }
      case "deployments": {
        const r = await api.deployments.list();
        for (const d of r.deployments) {
          process.stdout.write(`${d.id}  ${d.name.padEnd(24)}  ${d.status}  ${d.blueprintId}\n`);
        }
        break;
      }
      case "blueprints": {
        const r = await api.blueprints.list();
        for (const b of r.blueprints) {
          process.stdout.write(`${b.id.padEnd(30)}  v${b.version}  ${b.description}\n`);
        }
        break;
      }
      default:
        process.stderr.write(`unknown: ${args.what}\n`);
        process.exit(1);
    }
  },
});
