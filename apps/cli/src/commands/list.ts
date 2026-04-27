import { defineCommand } from "citty";

import { api } from "../lib/api.ts";

export default defineCommand({
  meta: { name: "list", description: "List runs/deployments/blueprints/versions." },
  args: {
    what: {
      type: "positional",
      required: true,
      description: "runs | deployments | blueprints | versions",
    },
    target: {
      type: "positional",
      required: false,
      description: "Blueprint id (for `versions`)",
    },
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
          const tag = d.blueprintTag && d.blueprintTag !== "latest" ? `:${d.blueprintTag}` : "";
          process.stdout.write(
            `${d.id}  ${d.name.padEnd(24)}  ${d.status}  ${d.blueprintId}${tag}\n`,
          );
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
      case "versions": {
        if (!args.target) {
          process.stderr.write("usage: oddjob list versions <ns/name>\n");
          process.exit(1);
        }
        const [versions, tags] = await Promise.all([
          api.blueprints.listVersions(args.target),
          api.blueprints.listTags(args.target),
        ]);
        const tagsByVersion = new Map<string, string[]>();
        for (const t of tags.tags) {
          const arr = tagsByVersion.get(t.version) ?? [];
          arr.push(t.tag);
          tagsByVersion.set(t.version, arr);
        }
        for (const v of versions.versions) {
          const labels = tagsByVersion.get(v.version)?.sort().join(", ") ?? "";
          process.stdout.write(
            `${v.version.padEnd(12)}  ${labels.padEnd(20)}  ${v.contentHash.slice(0, 12)}  ${new Date(v.createdAt).toISOString()}\n`,
          );
        }
        break;
      }
      default:
        process.stderr.write(`unknown: ${args.what}\n`);
        process.exit(1);
    }
  },
});
