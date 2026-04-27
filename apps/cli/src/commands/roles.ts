import { defineCommand } from "citty";

import { api } from "../lib/api.ts";

export default defineCommand({
  meta: { name: "roles", description: "Manage engine model roles (default / advisor / grader)." },
  args: {
    action: { type: "positional", required: true, description: "list | set | delete" },
    role: {
      type: "positional",
      required: false,
      description: "default | advisor | grader | <custom>",
    },
    target: {
      type: "positional",
      required: false,
      description: "<provider>/<model> (e.g. openai/gpt-4o)",
    },
    credentialName: { type: "string", default: "default" },
  },
  async run({ args }) {
    switch (args.action) {
      case "list": {
        const r = await api.roles.list();
        if (r.roles.length === 0) {
          process.stdout.write("(no role assignments)\n");
          break;
        }
        for (const a of r.roles) {
          process.stdout.write(
            `${a.role.padEnd(12)} ${a.providerSlug}/${a.modelId}  [${a.credentialName}]\n`,
          );
        }
        break;
      }
      case "set": {
        if (!args.role || !args.target) {
          throw new Error("usage: oddjob roles set <role> <provider>/<model>");
        }
        const slash = String(args.target).indexOf("/");
        if (slash < 0) throw new Error("target must be <provider>/<model>");
        const providerSlug = String(args.target).slice(0, slash);
        const modelId = String(args.target).slice(slash + 1);
        await api.roles.set(String(args.role), {
          providerSlug,
          modelId,
          credentialName: args.credentialName,
        });
        process.stdout.write(`set role '${args.role}' -> ${providerSlug}/${modelId}\n`);
        break;
      }
      case "delete": {
        if (!args.role) throw new Error("usage: oddjob roles delete <role>");
        await api.roles.remove(String(args.role));
        process.stdout.write(`deleted role '${args.role}'\n`);
        break;
      }
      default:
        process.stderr.write(`unknown action: ${args.action}\n`);
        process.exitCode = 1;
        return;
    }
  },
});
