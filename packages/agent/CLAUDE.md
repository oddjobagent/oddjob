# packages/agent

Agent runtime: the loop, tool registry, system-prompt assembly, output validation, grader, MCP/skill wiring, and pi-ai model-registry adapter. Carved out of `packages/core/` in the April 2026 re-arch (Phase B). `core/` is types/contracts only; `agent/` is where the run actually happens.

## Public surface

`packages/agent/src/index.ts` re-exports:
- `runOnce`, `RunOnceOptions`, `RunOnceResult`, `ResolvedLLM`, `GraderOverride` (loop)
- `validateOutput`, `composeOutputSchemaWithChannels` (output)
- `assembleSystemPrompt` (prompt)
- `createReportStatusTool`, `RunOutcome`, `RunVerdict` (verdict tool)
- `buildScriptTools` (script-tool)
- `buildBuiltinTools`, `buildSingleBuiltinTool` (builtin factories — kept for tests + plugin shims)
- `createEngineLLM`, `EngineLLM` (engine)
- `parseSkillFile`, `loadSkills`, `blueprintDirOf`, `resolveSkillPath` (skills loader)
- `listAllModels`, `listProviders`, `ModelDescriptor`, `ProviderDescriptor` (pi-ai model registry adapter)

## Layout

```
src/
├── loop.ts                # runOnce — the orchestrator
├── grader.ts              # runGrader, buildRevisionPrompt
├── system-prompt.ts       # 3-layer prompt assembler (preamble + blueprint + auto-injected)
├── output-validate.ts     # Ajv on blueprint.outputSchema; sticky hardFailureVerdict on failure
├── output-schema-compose.ts  # dynamic-channel composition
├── report-status-tool.ts  # the report_status tool the agent uses to declare verdict
├── script-tool.ts         # blueprint.scripts → AgentTool[]
├── skill-tool.ts          # buildSkillTool + buildSkillSystemPrompt
├── mcp-tool.ts            # buildMcpRuntime — wires McpSession into AgentTool[]
├── engine.ts              # createEngineLLM, AskAdvisorOptions
├── model-registry.ts      # pi-ai getProviders/getModels adapter (Phase F)
├── skills.ts              # loadSkills + parseSkillFile (moved from core)
└── builtin-tools/         # the 12 builtin tool factories (bash, read, write, edit, grep, find, ls, web_*, *_repl, datetime). Plugins/tools-* call buildSingleBuiltinTool to register these.
```

## Tool resolution flow

`runOnce` no longer iterates `BUILTIN_TOOL_NAMES` directly. For each name in `blueprint.tools`:
1. `opts.plugins?.toolFor(name)` — service IFF a plugin owns the name AND is enabled.
2. else if `opts.plugins?.hasTool(name)` — name claimed but plugin disabled → log warn + skip (honor disable).
3. else if `isBuiltinToolName(name)` — fallback to `buildSingleBuiltinTool(name, ctx)` for tests / no-registry setups.
4. else log warn + skip.

`ToolBuildContext` carries `{environment, blueprintDir, engine, onLog, plugins, secrets, state, envAllowedHosts, engineRequiredHosts}`. Plugin-resolved web_fetch / web_search use these for backend dispatch + egress gates.

## Why the split exists

`core/` used to mix types, parsers, AND agent runtime. The dashboard imports `@oddjob/core` for types only — but at runtime that pulled in agent code transitively. Splitting `agent/` out keeps `core/` browser-safe (almost — it has Bun deps via Ajv but no Bun built-ins reachable from types) and lets future "remote dashboard" stories not bundle the agent.

`agent/` depends on `core/`, never the reverse. If you need a type in core that lives in agent today, move the TYPE to core (leave the runtime function in agent). Example: `BUILTIN_TOOL_NAMES` + `EngineConfig` + `BuiltinToolsConfig` live in `core/types/builtin-tools.ts` because blueprint validation needs them; the build functions stay in agent.

## Gotchas

- **Inline `import("../path")` types** survive sed-based path rewrites less well than `from "..."` imports — when adding new path-based type imports, use the bare-import form so future moves are mechanical.
- **Skills loader** uses Node `fs`. Tests that run in browser-like environments can't import this. Keep skill-tool (which only uses LoadedSkill type) separate from skills.ts (the loader).
- **mcp-tool's `import("../index.ts")`** pattern was the trickiest thing to migrate during Phase B — it pulled in core types via core's main index. Always import types from `@oddjob/core` directly now.
