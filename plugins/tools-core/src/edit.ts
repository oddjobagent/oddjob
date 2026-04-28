import { buildSingleBuiltinTool } from "@oddjob/agent";
import type { ToolService, ToolBuildContext } from "@oddjob/sdk";

// Edit an existing file in the sandbox.
export const editTool: Omit<ToolService, "kind"> = {
  name: "edit",
  build: (ctx: ToolBuildContext) => {
    const tool = buildSingleBuiltinTool("edit", ctx);
    if (!tool) throw new Error("edit tool could not be built");
    return tool;
  },
};
