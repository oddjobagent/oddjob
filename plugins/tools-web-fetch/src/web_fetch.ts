import { buildSingleBuiltinTool } from "@oddjob/agent";
import type { ToolService, ToolBuildContext } from "@oddjob/sdk";

// Fetch a URL and return the body as markdown. SSRF guarded; dispatches through
// a registered web-fetch backend (raw, Browserbase, Firecrawl, ScrapingBee).
export const webFetchTool: Omit<ToolService, "kind"> = {
  name: "web_fetch",
  build: (ctx: ToolBuildContext) => {
    const tool = buildSingleBuiltinTool("web_fetch", ctx);
    if (!tool) throw new Error("web_fetch tool could not be built");
    return tool;
  },
};
