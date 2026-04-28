import { buildSingleBuiltinTool } from "@oddjob/agent";
import type { ToolService, ToolBuildContext } from "@oddjob/sdk";

// Web search via configured backend (Brave, Tavily, SearXNG, Exa, SerpAPI).
export const webSearchTool: Omit<ToolService, "kind"> = {
  name: "web_search",
  build: (ctx: ToolBuildContext) => {
    const tool = buildSingleBuiltinTool("web_search", ctx);
    if (!tool) throw new Error("web_search tool could not be built");
    return tool;
  },
};
