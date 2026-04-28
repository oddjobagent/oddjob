import { buildSingleBuiltinTool } from "@oddjob/agent";
import type { ToolService, ToolBuildContext } from "@oddjob/sdk";

// Run shell commands in the run sandbox.
export const bashTool: Omit<ToolService, "kind"> = {
  name: "bash",
  build: (ctx: ToolBuildContext) => {
    const tool = buildSingleBuiltinTool("bash", ctx);
    if (!tool) throw new Error("bash tool could not be built");
    return tool;
  },
};
