// Joiner: concatenates the per-source summaries into a markdown digest.
// Pure function on inputs — no LLM call, no tool dispatch. Demonstrates
// that script-mode blueprints can be plain TS code when they don't need
// the agent loop.

import { defineRun } from "@oddjob/sdk";

export default defineRun<
  { topic: string; summaries: string[] },
  { digest: string }
>({}, async (ctx) => {
  const { topic, summaries } = ctx.inputs;
  const lines: string[] = [`# ${topic}`, ""];
  summaries.forEach((s, i) => {
    lines.push(`## Source ${i + 1}`);
    lines.push("");
    lines.push(s);
    lines.push("");
  });
  return { digest: lines.join("\n") };
});
