// `oddjob deny <run-id> --reason "..."` — resolves a pending
// `ctx.requestApproval` for a script-mode run with approved=false.
// (COMPOSABLE_BLUEPRINTS Phase 2)

import { defineCommand } from "citty";

import { loadConfig, serverUrl } from "../lib/config.ts";

export default defineCommand({
  meta: {
    name: "deny",
    description: "Deny a pending ctx.requestApproval on a script-mode run.",
  },
  args: {
    runId: {
      type: "positional",
      required: true,
      description: "Run id with a pending approval.",
    },
    reason: {
      type: "string",
      required: true,
      description: "Required: free-form reason recorded with the deny resolution.",
    },
    resolver: {
      type: "string",
      description: "Identity of the denier (default: cli:<USER>).",
    },
  },
  async run({ args }) {
    const cfg = await loadConfig();
    const base = serverUrl(cfg);
    const resolver = args.resolver ?? `cli:${process.env.USER ?? "unknown"}`;
    const body = {
      approved: false,
      reason: args.reason,
      resolver,
    };
    const r = await fetch(`${base}/api/v1/runs/${encodeURIComponent(args.runId)}/approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`deny failed (${r.status}): ${txt}`);
    }
    const out = (await r.json()) as { runId: string; approved: boolean };
    process.stdout.write(`denied run ${out.runId}\n`);
  },
});
