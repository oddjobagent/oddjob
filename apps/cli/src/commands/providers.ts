import { defineCommand } from "citty";

import { api } from "../lib/api.ts";

export default defineCommand({
  meta: {
    name: "providers",
    description: "Manage model providers (list / get / set-key / refresh).",
  },
  args: {
    action: {
      type: "positional",
      required: true,
      description: "list | get | set-key | refresh | delete-key",
    },
    slug: { type: "positional", required: false },
    apiKey: { type: "string", required: false, description: "API key value (for set-key)" },
    stdin: { type: "boolean", default: false, description: "Read api key from stdin" },
    credentialName: { type: "string", default: "default" },
    options: { type: "string", required: false, description: "JSON options (baseUrl, ...)" },
  },
  async run({ args }) {
    switch (args.action) {
      case "list": {
        const r = await api.providers.list();
        for (const p of r.providers) {
          const cred = p.hasCredentials ? "key" : "no-key";
          const refresh = p.hasRefresh ? "live" : "static";
          process.stdout.write(
            `${p.slug.padEnd(16)} ${refresh.padEnd(7)} ${cred.padEnd(7)} ${p.models} models  ${p.displayName}\n`,
          );
        }
        break;
      }
      case "get": {
        if (!args.slug) throw new Error("usage: oddjob providers get <slug>");
        const r = await api.providers.get(String(args.slug));
        process.stdout.write(`${r.slug} (${r.displayName})\n`);
        if (r.authHint) process.stdout.write(`  ${r.authHint}\n`);
        process.stdout.write(`  models:\n`);
        for (const m of r.models) {
          const cost = `$${m.inputCostPerMillion}/in $${m.outputCostPerMillion}/out per 1M`;
          process.stdout.write(
            `    ${m.id.padEnd(40)} ${m.contextWindow.toString().padStart(8)}ctx  ${cost}\n`,
          );
        }
        if (r.credentials.length > 0) {
          process.stdout.write(
            `  credentials: ${r.credentials.map((c) => c.credentialName).join(", ")}\n`,
          );
        }
        break;
      }
      case "set-key": {
        if (!args.slug)
          throw new Error("usage: oddjob providers set-key <slug> [--api-key VALUE | --stdin]");
        let key = args.apiKey;
        if (args.stdin) key = (await Bun.stdin.text()).trim();
        if (!key) throw new Error("api key required (--api-key or --stdin)");
        const options = args.options
          ? (JSON.parse(args.options) as Record<string, unknown>)
          : undefined;
        await api.providers.upsertCredential(String(args.slug), {
          credentialName: args.credentialName,
          apiKey: key,
          options,
        });
        process.stdout.write(`set ${args.slug}/${args.credentialName} api key\n`);
        break;
      }
      case "delete-key": {
        if (!args.slug) throw new Error("usage: oddjob providers delete-key <slug>");
        await api.providers.deleteCredential(String(args.slug), args.credentialName);
        process.stdout.write(`deleted ${args.slug}/${args.credentialName}\n`);
        break;
      }
      case "refresh": {
        if (!args.slug) throw new Error("usage: oddjob providers refresh <slug>");
        const r = await api.providers.refresh(String(args.slug));
        process.stdout.write(`refreshed ${r.slug}: ${r.count} models\n`);
        break;
      }
      default:
        process.stderr.write(`unknown action: ${args.action}\n`);
        process.exitCode = 1;
        return;
    }
  },
});
