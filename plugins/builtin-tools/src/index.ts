// @oddjob/plugin-builtin-tools — bundles the 12 built-in agent tools
// (bash, read, write, edit, grep, find, ls, web_fetch, web_search,
//  python_repl, javascript_repl, datetime).
//
// Each ToolService entry delegates into core's `buildSingleBuiltinTool` so the
// legacy switch-statement path and the registry path share one implementation.

import { BUILTIN_TOOL_NAMES, buildSingleBuiltinTool } from "@oddjob/agent";
import { definePlugin, type ToolBuildContext } from "@oddjob/sdk";

const TOOL_DESCRIPTIONS: Record<string, string> = {
  bash: "Run shell commands in the run sandbox.",
  read: "Read a file from the sandbox.",
  write: "Write a file in the sandbox.",
  edit: "Edit an existing file in the sandbox.",
  grep: "Search file contents with regex.",
  find: "Find files by glob pattern.",
  ls: "List directory contents.",
  web_fetch: "Fetch a URL and return body as markdown. SSRF guarded.",
  web_search: "Web search via Brave / Tavily / SearXNG.",
  python_repl: "Execute Python via system python3.",
  javascript_repl: "Execute JavaScript/TypeScript via bun -e.",
  datetime: "Get the current date/time in arbitrary timezones.",
};

export default definePlugin(
  {
    slug: "builtin-tools",
    name: "Built-in Tools",
    description: "Bundled agent tools available to any blueprint via the `tools` allowlist.",
    version: "0.1.0",
    author: "Oddjob",
  },
  (b) => {
    for (const name of BUILTIN_TOOL_NAMES) {
      b.tool({
        name,
        build: (ctx: ToolBuildContext) => {
          const tool = buildSingleBuiltinTool(name, ctx);
          if (!tool) throw new Error(`builtin tool '${name}' could not be built`);
          return tool;
        },
      });
      // Description is metadata only; consumed by /api/v1/plugins detail.
      void TOOL_DESCRIPTIONS[name];
    }
  },
);
