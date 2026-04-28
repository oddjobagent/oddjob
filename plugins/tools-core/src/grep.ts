import { buildSingleBuiltinTool } from "@oddjob/agent";
import type { ToolService, ToolBuildContext } from "@oddjob/sdk";

// Search file contents with regex (session-aware; routes through EnvironmentSession).
export const grepTool: Omit<ToolService, "kind"> = {
  name: "grep",
  build: (ctx: ToolBuildContext) => {
    const tool = buildSingleBuiltinTool("grep", ctx);
    if (!tool) throw new Error("grep tool could not be built");
    return tool;
  },
};
