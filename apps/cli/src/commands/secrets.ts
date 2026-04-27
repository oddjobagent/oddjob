import { defineCommand } from "citty";

import { api } from "../lib/api.ts";

export default defineCommand({
  meta: { name: "secrets", description: "Manage secrets (set / list / delete)." },
  args: {
    action: { type: "positional", required: true, description: "set | list | delete" },
    name: { type: "positional", required: false },
    value: { type: "positional", required: false, description: "Value (or use --stdin)" },
    stdin: { type: "boolean", default: false, description: "Read value from stdin" },
  },
  async run({ args }) {
    switch (args.action) {
      case "list": {
        const r = await api.secrets.list();
        for (const n of r.secrets) process.stdout.write(`${n}\n`);
        break;
      }
      case "set": {
        if (!args.name) throw new Error("usage: oddjob secrets set NAME [VALUE | --stdin]");
        let value = args.value;
        if (args.stdin) value = (await Bun.stdin.text()).trim();
        if (!value) throw new Error("value required (positional or --stdin)");
        await api.secrets.set(args.name, value);
        process.stdout.write(`set ${args.name}\n`);
        break;
      }
      case "delete": {
        if (!args.name) throw new Error("usage: oddjob secrets delete NAME");
        await api.secrets.remove(args.name);
        process.stdout.write(`deleted ${args.name}\n`);
        break;
      }
      default:
        process.stderr.write(`unknown action: ${args.action}\n`);
        process.exit(1);
    }
  },
});
