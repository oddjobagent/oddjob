import { buildSingleBuiltinTool } from "@oddjob/agent";
import type { ToolService, ToolBuildContext } from "@oddjob/sdk";

// Execute JavaScript/TypeScript via `bun -e` subprocess. WASM/QuickJS is broken on Bun.
export const javascriptReplTool: Omit<ToolService, "kind"> = {
  name: "javascript_repl",
  build: (ctx: ToolBuildContext) => {
    const tool = buildSingleBuiltinTool("javascript_repl", ctx);
    if (!tool) throw new Error("javascript_repl tool could not be built");
    return tool;
  },
};
