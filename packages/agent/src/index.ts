// Agent runtime exports.
//
// This package owns the agent loop, system-prompt assembly, output validation,
// grader, tool registry, and skill+MCP wiring. Pure types/contracts live in
// @oddjob/core; concrete tool/provider impls live in plugins.

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
export { buildScriptTools, type ScriptToolOptions } from "./script-tool.ts";

export {
  buildBuiltinTools,
  buildSingleBuiltinTool,
  isBuiltinToolName,
  BUILTIN_TOOL_NAMES,
  type BuiltinToolName,
  type BuildBuiltinToolsOptions,
  type BuiltinToolsConfig,
  type EngineConfig,
  type WebSearchConfig,
  type WebFetchConfig,
} from "./builtin-tools/index.ts";

export {
  createEngineLLM,
  type EngineLLM,
  type AskAdvisorOptions,
  type CreateEngineLLMOptions,
} from "./engine.ts";

export { parseSkillFile, resolveSkillPath, loadSkills, blueprintDirOf } from "./skills.ts";

// SSRF guard primitives — exported so web-fetch backends can re-validate
// resolved IPs at connect time without re-implementing the CIDR sets.
// Drift between dispatcher gate (assertSafeUrl) and connect-time pin is
// the exact thing this exposes for plugins to share.
export { assertSafeUrl, isPrivateV4, isPrivateV6, SsrfBlockedError } from "./builtin-tools/ssrf.ts";

export {
  listAllModels,
  listProviders,
  type ModelDescriptor,
  type ProviderDescriptor,
} from "./model-registry.ts";
