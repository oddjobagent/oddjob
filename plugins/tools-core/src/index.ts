// @oddjob/plugin-tools-core — bundles 8 core agent tools
// (bash, read, write, edit, grep, find, ls, datetime).
//
// Each tool registers as a ToolService against the plugin registry. The
// underlying factories live in @oddjob/agent's coding-tools-adapter (which
// wraps pi-coding-agent's createBashTool/etc.) and datetime.ts. This plugin
// is the user-facing seam — strip it and the agent has no default tool set.

import { definePlugin } from "@oddjob/sdk";

import { bashTool } from "./bash.ts";
import { datetimeTool } from "./datetime.ts";
import { editTool } from "./edit.ts";
import { findTool } from "./find.ts";
import { grepTool } from "./grep.ts";
import { lsTool } from "./ls.ts";
import { readTool } from "./read.ts";
import { writeTool } from "./write.ts";

export default definePlugin(
  {
    slug: "tools-core",
    name: "Core Tools",
    description: "Bundled core agent tools: bash, read, write, edit, grep, find, ls, datetime.",
    version: "0.1.0",
    author: "Oddjob",
  },
  (b) => {
    b.tool(bashTool);
    b.tool(readTool);
    b.tool(writeTool);
    b.tool(editTool);
    b.tool(grepTool);
    b.tool(findTool);
    b.tool(lsTool);
    b.tool(datetimeTool);
  },
);
