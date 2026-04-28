import { buildSingleBuiltinTool } from "@oddjob/agent";
import type { ToolService, ToolBuildContext } from "@oddjob/sdk";

// Read a file from the sandbox.
export const readTool: Omit<ToolService, "kind"> = {
  name: "read",
  build: (ctx: ToolBuildContext) => {
    const tool = buildSingleBuiltinTool("read", ctx);
    if (!tool) throw new Error("read tool could not be built");
    return tool;
  },
};
