// `oddjob approve <run-id> [--reason "..."]` — resolves a pending
// `ctx.requestApproval` for a script-mode run with approved=true.
// (COMPOSABLE_BLUEPRINTS Phase 2)

import { defineCommand } from "citty";

import { loadConfig, serverUrl } from "../lib/config.ts";

export default defineCommand({
  meta: {
    name: "approve",
    description: "Approve a pending ctx.requestApproval on a script-mode run.",
  },
  args: {
    runId: {
      type: "positional",
      required: true,
      description: "Run id with a pending approval.",
    },
    reason: {
      type: "string",
      description: "Free-form reason recorded with the resolution.",
    },
    resolver: {
      type: "string",
      description: "Identity of the approver (default: cli:<USER> from $USER).",
    },
  },
  async run({ args }) {
    const cfg = await loadConfig();
    const base = serverUrl(cfg);
    const resolver = args.resolver ?? `cli:${process.env.USER ?? "unknown"}`;
    const body = {
      approved: true,
      ...(args.reason ? { reason: args.reason } : {}),
      resolver,
    };
    const r = await fetch(`${base}/api/v1/runs/${encodeURIComponent(args.runId)}/approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`approve failed (${r.status}): ${txt}`);
    }
    const out = (await r.json()) as { runId: string; approved: boolean };
    process.stdout.write(`approved run ${out.runId}\n`);
  },
});
