import { openBrowser } from "@oddjob/core";
import { defineCommand } from "citty";

import { api } from "../lib/api.ts";

export interface RunOAuthFlowOptions {
  deploymentRef: string;
  connectorName: string;
}

export async function runOAuthFlow(opts: RunOAuthFlowOptions): Promise<void> {
  const list = await api.deployments.list({ includeArchived: true });
  const dep = list.deployments.find(
    (d) => d.id === opts.deploymentRef || d.name === opts.deploymentRef,
  );
  if (!dep) throw new Error(`deployment '${opts.deploymentRef}' not found`);

  const result = await api.auth.initiate(dep.id, opts.connectorName);
  if (!result.redirectUrl) {
    process.stdout.write(`status: ${result.status}\n`);
    if (result.message) process.stdout.write(`${result.message}\n`);
    process.exit(1);
  }

  await openBrowser(result.redirectUrl);
  process.stdout.write("Opened browser. Waiting for authorization (max 5 minutes)...\n");

  const maxPolls = 300;
  let last = "pending";
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    let s: { status: string };
    try {
      s = await api.auth.status(result.connectorId);
    } catch (e) {
      process.stdout.write(`✗ Authorization failed: ${(e as Error).message}\n`);
      process.exit(1);
    }
    last = s.status;
    if (last === "authenticated") {
      process.stdout.write("✓ Authorized.\n");
      return;
    }
    if (last === "failed" || last === "expired" || last === "reauth_needed") {
      process.stdout.write(`✗ Authorization failed: ${last}\n`);
      process.exit(1);
    }
  }
  process.stdout.write(`✗ Authorization failed: timeout (last status: ${last})\n`);
  process.exit(1);
}

const auth = defineCommand({
  meta: { name: "auth", description: "Initiate OAuth flow for a connector on a deployment." },
  args: {
    deployment: { type: "positional", required: true, description: "Deployment id or name" },
    connector: { type: "positional", required: true, description: "Connector name from blueprint" },
  },
  async run({ args }) {
    await runOAuthFlow({ deploymentRef: args.deployment, connectorName: args.connector });
  },
});

const list = defineCommand({
  meta: { name: "list", description: "List MCP connectors declared on a blueprint." },
  args: {
    blueprintId: { type: "positional", required: true, description: "<namespace>/<name>" },
  },
  async run({ args }) {
    const bp = await api.blueprints.get(args.blueprintId);
    const connectors = Object.entries(bp.connectors);
    if (connectors.length === 0) {
      process.stdout.write("(no connectors)\n");
      return;
    }
    for (const [name, c] of connectors) {
      process.stdout.write(`${name.padEnd(20)} ${c.transport.padEnd(8)} auth=${c.auth.kind}\n`);
    }
  },
});

export default defineCommand({
  meta: { name: "mcp", description: "Manage MCP connectors on blueprints." },
  subCommands: {
    auth: () => Promise.resolve(auth),
    list: () => Promise.resolve(list),
  },
});
