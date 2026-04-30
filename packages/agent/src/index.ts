// Agent runtime exports.
//
// This package owns the agent loop, system-prompt assembly, output validation,
// grader, internal-tool factories, and skill+MCP wiring. Pure types/contracts
// live in @oddjob/core; plugin-contributed tool/provider impls live in plugins.

export {
  runOnce,
  type RunOnceOptions,
  type RunOnceResult,
  type ResolvedLLM,
  type GraderOverride,
} from "./loop.ts";

export { validateOutput } from "./output-validate.ts";
export {
  composeOutputSchemaWithChannels,
  type DynamicChannelDescriptor,
} from "./output-schema-compose.ts";

export { assembleSystemPrompt, type AssembleSystemPromptOptions } from "./system-prompt.ts";
export { createReportStatusTool, type RunOutcome, type RunVerdict } from "./report-status-tool.ts";

export {
  buildInternalTool,
  INTERNAL_TOOL_NAMES,
  isInternalToolName,
  type InternalToolName,
  type BuildInternalToolContext,
  buildScriptTools,
  type ScriptToolOptions,
  buildSkillTool,
  buildSkillSystemPrompt,
  buildMcpRuntime,
  type McpRuntime,
  type McpToolBuilderOptions,
  // Per-tool factories — exported for tests / direct construction.
  createBashTool,
  createDatetimeTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createJavascriptTool,
  createLsTool,
  createPythonTool,
  createReadTool,
  createWriteTool,
  // Security primitives shared with web-fetch / web-search plugins.
  assertSafeUrl,
  isPrivateV4,
  isPrivateV6,
  SsrfBlockedError,
  checkEnvAllowlist,
  type EnvGateResult,
} from "./tools/index.ts";

export type { EngineConfig, BuiltinToolsConfig, WebSearchConfig, WebFetchConfig } from "@oddjob/core";

export {
  createEngineLLM,
  type EngineLLM,
  type AskAdvisorOptions,
  type CreateEngineLLMOptions,
} from "./engine.ts";

export { parseSkillFile, resolveSkillPath, loadSkills, blueprintDirOf } from "./skills.ts";

export {
  listAllModels,
  listProviders,
  type ModelDescriptor,
  type ProviderDescriptor,
} from "./model-registry.ts";
