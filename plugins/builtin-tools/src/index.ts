// @oddjob/plugin-builtin-tools — interim bundle for the 4 tools not yet
// extracted to dedicated plugins: web_fetch, web_search, python_repl,
// javascript_repl. tools-core (8 tools) now lives in @oddjob/plugin-tools-core.
// Phase C2/C3 will move the rest into tools-coding/tools-web-fetch/
// tools-web-search and this plugin will be deleted.

import { buildSingleBuiltinTool } from "@oddjob/agent";
import { definePlugin, type ToolBuildContext } from "@oddjob/sdk";

const REMAINING_TOOLS = ["web_fetch", "web_search", "python_repl", "javascript_repl"] as const;

export default definePlugin(
  {
    slug: "builtin-tools",
    name: "Built-in Tools (interim)",
    description: "Interim bundle for web_fetch, web_search, python_repl, javascript_repl.",
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
