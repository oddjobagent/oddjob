import { buildSingleBuiltinTool } from "@oddjob/agent";
import type { ToolService, ToolBuildContext } from "@oddjob/sdk";

// List directory contents.
export const lsTool: Omit<ToolService, "kind"> = {
  name: "ls",
  build: (ctx: ToolBuildContext) => {
    const tool = buildSingleBuiltinTool("ls", ctx);
    if (!tool) throw new Error("ls tool could not be built");
    return tool;
  },
};
