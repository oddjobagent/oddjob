import { buildSingleBuiltinTool } from "@oddjob/agent";
import type { ToolService, ToolBuildContext } from "@oddjob/sdk";

// Write a file in the sandbox.
export const writeTool: Omit<ToolService, "kind"> = {
  name: "write",
  build: (ctx: ToolBuildContext) => {
    const tool = buildSingleBuiltinTool("write", ctx);
    if (!tool) throw new Error("write tool could not be built");
    return tool;
  },
};
