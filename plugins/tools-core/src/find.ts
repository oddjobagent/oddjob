import { buildSingleBuiltinTool } from "@oddjob/agent";
import type { ToolService, ToolBuildContext } from "@oddjob/sdk";

// Find files by glob pattern.
export const findTool: Omit<ToolService, "kind"> = {
  name: "find",
  build: (ctx: ToolBuildContext) => {
    const tool = buildSingleBuiltinTool("find", ctx);
    if (!tool) throw new Error("find tool could not be built");
    return tool;
  },
};
