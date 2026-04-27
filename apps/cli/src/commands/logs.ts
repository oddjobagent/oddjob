import { defineCommand } from "citty";

import { api } from "../lib/api.ts";

export default defineCommand({
  meta: { name: "logs", description: "Show logs for a run." },
  args: {
    runId: { type: "positional", required: true, description: "Run UUID" },
    tail: { type: "boolean", default: false, description: "Follow new entries" },
  },
  async run({ args }) {
    let since = 0;
    while (true) {
      const r = await api.runs.logs(args.runId, since);
      for (const entry of r.entries) {
        const t = entry.timestamp as number;
        const lvl = entry.level as string;
        const msg = entry.message as string;
        process.stdout.write(`${new Date(t).toISOString()} ${lvl.padEnd(5)} ${msg}\n`);
        if (t >= since) since = t + 1;
      }
      if (!args.tail) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  },
});
