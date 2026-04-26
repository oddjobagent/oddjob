import { defineCommand } from "citty";

import { api } from "../lib/api.ts";

export default defineCommand({
  meta: { name: "output", description: "Show the output of a completed run." },
  args: {
    runId: { type: "positional", required: true, description: "Run UUID" },
    json: { type: "boolean", default: false, description: "Output JSON only" },
  },
  async run({ args }) {
    const r = await api.runs.get(args.runId);
    if (args.json) {
      process.stdout.write(JSON.stringify(r.output ?? {}, null, 2) + "\n");
      return;
    }
    process.stdout.write(`status: ${r.status}\n`);
    if (r.error) process.stdout.write(`error: ${r.error}\n`);
    if (r.output?.finalText) {
      process.stdout.write("\n" + r.output.finalText + "\n");
    }
    if (r.output?.structuredOutput) {
      process.stdout.write("\nstructured:\n");
      process.stdout.write(JSON.stringify(r.output.structuredOutput, null, 2) + "\n");
    }
  },
});
