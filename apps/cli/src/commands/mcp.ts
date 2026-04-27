import { defineCommand } from "citty";

import { api } from "../lib/api.ts";

const auth = defineCommand({
  meta: { name: "auth", description: "Initiate OAuth flow for a connector on a deployment." },
  args: {
    deployment: { type: "positional", required: true, description: "Deployment id or name" },
    connector: { type: "positional", required: true, description: "Connector name from blueprint" },
  },
  async run({ args }) {
    // Resolve deployment by id or name.
    const list = await api.deployments.list({ includeArchived: true });
    const dep = list.deployments.find((d) => d.id === args.deployment || d.name === args.deployment);
    if (!dep) throw new Error(`deployment '${args.deployment}' not found`);

    const result = await api.auth.initiate(dep.id, args.connector);
    if (result.redirectUrl) {
      process.stdout.write(`Open in your browser to authorize:\n  ${result.redirectUrl}\n`);
      process.stdout.write(
        `\nA local callback server is listening. After you grant access, the token will be persisted.\n`,
      );
    } else {
      process.stdout.write(`status: ${result.status}\n`);
      if (result.message) process.stdout.write(`${result.message}\n`);
    }
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
      process.stdout.write(
        `${name.padEnd(20)} ${c.transport.padEnd(8)} auth=${c.auth.kind}\n`,
      );
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
