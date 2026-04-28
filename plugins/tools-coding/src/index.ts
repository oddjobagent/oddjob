// @oddjob/plugin-tools-coding — bundles coding REPL tools.
//
// python_repl + javascript_repl run in subprocesses (system python3 + bun -e).
// WASM-based REPLs (QuickJS, Pyodide) are broken on Bun's runtime — see the
// project_builtin_tools memory note. The implementations live in
// @oddjob/agent's builtin-tools/{python_repl,javascript_repl}.ts.

import { definePlugin } from "@oddjob/sdk";

import { javascriptReplTool } from "./javascript_repl.ts";
import { pythonReplTool } from "./python_repl.ts";

export default definePlugin(
  {
    slug: "tools-coding",
    name: "Coding Tools",
    description: "Bundled REPL tools: python_repl, javascript_repl.",
    version: "0.1.0",
    author: "Oddjob",
  },
  (b) => {
    b.tool(pythonReplTool);
    b.tool(javascriptReplTool);
  },
);
