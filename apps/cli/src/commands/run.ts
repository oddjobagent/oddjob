import { defineCommand } from "citty";

import { api } from "../lib/api.ts";

export default defineCommand({
  meta: { name: "run", description: "Trigger a deployment by name and stream the result." },
  args: {
    target: { type: "positional", required: true, description: "Deployment name or id" },
    input: { type: "string", description: "JSON input payload (or use --stdin)" },
    stdin: { type: "boolean", default: false, description: "Read input from stdin" },
    follow: { type: "boolean", default: true, description: "Poll until run finishes" },
  },
  async run({ args }) {
    let input: unknown = undefined;
    if (args.stdin) input = await Bun.stdin.text();
    else if (args.input) {
      try {
        input = JSON.parse(args.input);
      } catch {
        input = args.input;
      }
    }

    const dep = await resolveDeployment(args.target);
    const { run_id: runId } = await api.deployments.trigger(dep.id, input);
    process.stdout.write(`run ${runId} enqueued for ${dep.name}\n`);
    if (!args.follow) return;

    type R = { status: string; output?: { finalText?: string } };
    let last: R | null = null;
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const r = (await api.runs.get(runId)) as unknown as R;
        last = r;
        if (r.status === "complete" || r.status === "failed") break;
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status !== 404) throw err;
      }
    }
    process.stdout.write(`status: ${last?.status ?? "(timeout)"}\n`);
    if (last?.output?.finalText) process.stdout.write(`\n${last.output.finalText}\n`);
  },
});

async function resolveDeployment(target: string): Promise<{ id: string; name: string }> {
  const list = await api.deployments.list();
  const match = list.deployments.find((d) => d.name === target || d.id === target);
  if (!match) throw new Error(`deployment '${target}' not found`);
  return match;
}
