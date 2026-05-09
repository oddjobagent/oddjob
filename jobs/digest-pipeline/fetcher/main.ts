// Stub fetcher. Returns a synthetic body so the demo runs offline. A real
// fetcher would `await ctx.tool("web_fetch", { url })` — the parent's
// engine config controls which web-fetch backend (raw / firecrawl /
// browserbase / scrapingbee) actually fires.

import { defineRun } from "@oddjob/sdk";

export default defineRun<{ url: string }, { url: string; body: string }>({}, async (ctx) => {
  const url = ctx.inputs.url;
  // Recorded helpers — same value on replay. Any time-dependent logic
  // user-side MUST go through ctx.now/uuid/random or break replay.
  const fetchedAt = await ctx.now();
  return {
    url,
    body:
      `[stub fetched ${url} at ${fetchedAt.toISOString()}]\n\n` +
      `This is a placeholder document about ${url}. ` +
      `In a real digest-pipeline, this body would come from a web_fetch call.`,
  };
});
