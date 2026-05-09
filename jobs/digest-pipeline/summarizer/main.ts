// Stub summarizer. Truncates the source to one sentence. A real
// summarizer would invoke an agent loop via ctx.runAgent({prompt,
// outputSchema}) — that's deferred to Phase C.

import { defineRun } from "@oddjob/sdk";

export default defineRun<{ source: string }, { summary: string }>({}, async (_ctx) => {
  const source = _ctx.inputs.source;
  const firstSentence = source.split(/[.!?]\s/)[0] ?? source.slice(0, 200);
  return { summary: firstSentence.trim() + "." };
});
