import { buildSingleBuiltinTool } from "@oddjob/agent";
import type { ToolService, ToolBuildContext } from "@oddjob/sdk";

// Get the current date/time in arbitrary timezones.
export const datetimeTool: Omit<ToolService, "kind"> = {
  name: "datetime",
  build: (ctx: ToolBuildContext) => {
    const tool = buildSingleBuiltinTool("datetime", ctx);
    if (!tool) throw new Error("datetime tool could not be built");
    return tool;
  },
};
