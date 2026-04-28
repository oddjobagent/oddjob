// @oddjob/plugin-builtin-tools — interim bundle for the 2 tools not yet
// extracted to dedicated plugins: web_fetch, web_search.
// tools-core (8 tools) now lives in @oddjob/plugin-tools-core.
// tools-coding (python_repl, javascript_repl) lives in @oddjob/plugin-tools-coding.
// Phase C3 will move web_fetch/web_search into tools-web-fetch/tools-web-search
// and this plugin will be deleted.

import { buildSingleBuiltinTool } from "@oddjob/agent";
import { definePlugin, type ToolBuildContext } from "@oddjob/sdk";

const REMAINING_TOOLS = ["web_fetch", "web_search"] as const;

export default definePlugin(
  {
    slug: "builtin-tools",
    name: "Built-in Tools (interim)",
    description: "Interim bundle for web_fetch, web_search.",
    version: "0.1.0",
    author: "Oddjob",
  },
  (b) => {
    for (const name of REMAINING_TOOLS) {
      b.tool({
        name,
        build: (ctx: ToolBuildContext) => {
          const tool = buildSingleBuiltinTool(name, ctx);
          if (!tool) throw new Error(`builtin tool '${name}' could not be built`);
          return tool;
        },
      });
    }
  },
);
