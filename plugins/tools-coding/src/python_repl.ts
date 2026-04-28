import { buildSingleBuiltinTool } from "@oddjob/agent";
import type { ToolService, ToolBuildContext } from "@oddjob/sdk";

// Execute Python via subprocess (system python3). WASM/Pyodide is broken on Bun.
export const pythonReplTool: Omit<ToolService, "kind"> = {
  name: "python_repl",
  build: (ctx: ToolBuildContext) => {
    const tool = buildSingleBuiltinTool("python_repl", ctx);
    if (!tool) throw new Error("python_repl tool could not be built");
    return tool;
  },
};
