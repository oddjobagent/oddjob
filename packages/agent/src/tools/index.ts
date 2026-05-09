// Internal agent tools — bash/read/write/edit/grep/find/ls/datetime/javascript/python.
// Built directly by the agent loop; bypass the plugin registry. Plugin-contributed
// tools (web_fetch, web_search, anything user-installed) live in plugins/ and
// resolve via PluginRegistry.
//
// Auto-included tools — scripts (blueprint.scripts), skills (blueprint.skills),
// mcp (blueprint.connectors) — are built from blueprint sections rather than
// from the tools allowlist. They are exported from this folder but assembled
// in loop.ts as separate phases.

import type { TSchema } from "typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

import {
  INTERNAL_TOOL_NAMES,
  isInternalToolName,
  type EngineConfig,
  type EnvironmentSession,
  type InternalToolName,
  type LogEntry,
  type PluginRegistry,
  type SecretsProvider,
  type StateProvider,
} from "@oddjob/core";

import { createBashTool } from "./bash.ts";
import { createDatetimeTool } from "./datetime.ts";
import { createEditTool } from "./edit.ts";
import { createFindTool } from "./find.ts";
import { createGrepTool } from "./grep.ts";
import { createJavascriptTool } from "./javascript.ts";
import { createLsTool } from "./ls.ts";
import { createNotesAppendTool, createNotesReadTool } from "./notes.ts";
import { createPythonTool } from "./python.ts";
import { createReadTool } from "./read.ts";
import { createWriteTool } from "./write.ts";

export { INTERNAL_TOOL_NAMES, isInternalToolName, type InternalToolName };

/**
 * Inputs every internal-tool factory accepts. Subset of the loop's full
 * ToolBuildContext — `plugins`, `secrets`, `state`, and host-allowlists are
 * unused by internals (only plugin-contributed tools care).
 */
export interface BuildInternalToolContext {
  environment: EnvironmentSession;
  blueprintDir: string;
  engine?: EngineConfig;
  onLog?: (entry: LogEntry) => void;
  // Carried so the type matches ToolBuildContext for unified call sites.
  plugins?: PluginRegistry;
  secrets?: SecretsProvider;
  state?: StateProvider;
  envAllowedHosts?: readonly string[];
  engineRequiredHosts?: readonly string[];
}

/**
 * Build a single internal tool by name. Returns undefined if `name` is not
 * an internal tool — callers should fall through to the plugin registry.
 */
export function buildInternalTool(
  name: string,
  ctx: BuildInternalToolContext,
): AgentTool<TSchema> | undefined {
  if (!isInternalToolName(name)) return undefined;
  const cwd = ctx.blueprintDir;
  const builtinCfg = ctx.engine?.builtinTools;
  switch (name) {
    case "bash":
      return createBashTool({ cwd, environment: ctx.environment });
    case "read":
      return createReadTool({ cwd, environment: ctx.environment });
    case "write":
      return createWriteTool({ cwd, environment: ctx.environment });
    case "edit":
      return createEditTool({ cwd, environment: ctx.environment });
    case "grep":
      return createGrepTool({ cwd, environment: ctx.environment });
    case "find":
      return createFindTool({ cwd, environment: ctx.environment });
    case "ls":
      return createLsTool({ cwd, environment: ctx.environment });
    case "datetime":
      return createDatetimeTool() as AgentTool<TSchema>;
    case "javascript":
      return createJavascriptTool({
        environment: ctx.environment,
        defaultTimeoutMs: builtinCfg?.javascript?.timeoutMs,
        onLog: ctx.onLog,
      }) as AgentTool<TSchema>;
    case "python":
      return createPythonTool({
        environment: ctx.environment,
        defaultTimeoutMs: builtinCfg?.python?.timeoutMs,
        onLog: ctx.onLog,
      }) as AgentTool<TSchema>;
    case "notes_append":
      return createNotesAppendTool({ environment: ctx.environment }) as AgentTool<TSchema>;
    case "notes_read":
      return createNotesReadTool({ environment: ctx.environment }) as AgentTool<TSchema>;
    default: {
      const _exhaustive: never = name;
      return _exhaustive;
    }
  }
}

export { createBashTool } from "./bash.ts";
export { createDatetimeTool } from "./datetime.ts";
export { createEditTool } from "./edit.ts";
export { createFindTool } from "./find.ts";
export { createGrepTool } from "./grep.ts";
export { createJavascriptTool } from "./javascript.ts";
export { createLsTool } from "./ls.ts";
export { createNotesAppendTool, createNotesReadTool } from "./notes.ts";
export { createPythonTool } from "./python.ts";
export { createReadTool } from "./read.ts";
export { createWriteTool } from "./write.ts";
export { buildScriptTools, type ScriptToolOptions } from "./scripts.ts";
export { buildSkillTool, buildSkillSystemPrompt } from "./skills.ts";
export { buildMcpRuntime, type McpRuntime, type McpToolBuilderOptions } from "./mcp.ts";
export { assertSafeUrl, isPrivateV4, isPrivateV6, SsrfBlockedError } from "./security/ssrf.ts";
export { checkEnvAllowlist, type EnvGateResult } from "./security/egress.ts";
