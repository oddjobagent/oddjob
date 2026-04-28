import { defineCommand } from "citty";

import { api } from "../lib/api.ts";
import { runOAuthFlow } from "./mcp.ts";

const login = defineCommand({
  meta: {
    name: "login",
    description: "Start OAuth flow for a connector (alias for `oddjob mcp auth`).",
  },
  args: {
    deployment: { type: "positional", required: true, description: "Deployment id or name" },
    connector: { type: "positional", required: true, description: "Connector name from blueprint" },
  },
  async run({ args }) {
    await runOAuthFlow({ deploymentRef: args.deployment, connectorName: args.connector });
  },
});

const status = defineCommand({
  meta: { name: "status", description: "Show OAuth status for all connectors." },
  async run() {
    const { tokens } = await api.auth.list();
    if (tokens.length === 0) {
      process.stdout.write("(no oauth connectors)\n");
      return;
    }
    for (const t of tokens) {
      const exp = t.expiresAt ? new Date(t.expiresAt).toISOString() : "—";
      process.stdout.write(`${t.connectorId.padEnd(40)} ${t.status.padEnd(15)} expires=${exp}\n`);
    }
  },
});

const revoke = defineCommand({
  meta: { name: "revoke", description: "Delete a stored OAuth token." },
  args: {
    connectorId: { type: "positional", required: true, description: "<deploymentId>:<name>" },
  },
  async run({ args }) {
    await api.auth.revoke(args.connectorId);
    process.stdout.write(`revoked ${args.connectorId}\n`);
  },
});

export default defineCommand({
  meta: { name: "auth", description: "OAuth lifecycle for MCP connectors." },
  subCommands: {
    login: () => Promise.resolve(login),
    status: () => Promise.resolve(status),
    revoke: () => Promise.resolve(revoke),
  },
});
