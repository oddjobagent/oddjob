# packages/agent

Agent runtime: the loop, tool registry, system-prompt assembly, output validation, grader, MCP/skill wiring, and pi-ai model-registry adapter. Carved out of `packages/core/` in the April 2026 re-arch (Phase B). `core/` is types/contracts only; `agent/` is where the run actually happens.

## Public surface

`packages/agent/src/index.ts` re-exports:

- `runOnce`, `RunOnceOptions`, `RunOnceResult`, `ResolvedLLM`, `GraderOverride` (loop)
- `validateOutput`, `composeOutputSchemaWithChannels` (output)
- `assembleSystemPrompt` (prompt)
- `createReportStatusTool`, `RunOutcome`, `RunVerdict` (verdict tool)
- `buildInternalTool`, `INTERNAL_TOOL_NAMES`, `isInternalToolName` (internal tool dispatch)
- Per-tool factories: `createBashTool`, `createReadTool`, `createWriteTool`, `createEditTool`, `createGrepTool`, `createFindTool`, `createLsTool`, `createDatetimeTool`, `createJavascriptTool`, `createPythonTool`
- `buildScriptTools`, `buildSkillTool`, `buildMcpRuntime` (auto-included tool builders)
- `assertSafeUrl`, `isPrivateV4`, `isPrivateV6`, `SsrfBlockedError`, `checkEnvAllowlist` (security primitives shared with web-fetch / web-search plugins)
- `createEngineLLM`, `EngineLLM` (engine)
- `parseSkillFile`, `loadSkills`, `blueprintDirOf`, `resolveSkillPath` (skills loader)
- `listAllModels`, `listProviders`, `ModelDescriptor`, `ProviderDescriptor` (pi-ai model registry adapter)

## Layout

```
src/
├── loop.ts                # runOnce — the orchestrator
├── grader.ts              # runGrader, buildRevisionPrompt
├── system-prompt.ts       # 3-layer prompt assembler
├── output-validate.ts     # Ajv on blueprint.outputSchema; sticky hardFailureVerdict on failure
├── output-schema-compose.ts  # dynamic-channel composition
├── report-status-tool.ts  # report_status verdict tool
├── engine.ts              # createEngineLLM, AskAdvisorOptions
├── model-registry.ts      # pi-ai getProviders/getModels adapter
├── skills.ts              # loadSkills + parseSkillFile (uses node:fs)
└── tools/                 # internal tool factories + auto-included builders
    ├── index.ts           # buildInternalTool, INTERNAL_TOOL_NAMES, public re-exports
    ├── bash.ts / read.ts / write.ts / edit.ts / grep.ts / find.ts / ls.ts
    ├── datetime.ts
    ├── javascript.ts      # bun -e subprocess (via session)
    ├── python.ts          # python3 -c subprocess (via session)
    ├── coding-adapter.ts  # pi-coding-agent ops bridge + session-routed grep
    ├── scripts.ts         # blueprint.scripts → AgentTool[]
    ├── skills.ts          # buildSkillTool + buildSkillSystemPrompt
    ├── mcp.ts             # buildMcpRuntime — wires McpSession into AgentTool[]
    └── security/
        ├── egress.ts      # checkEnvAllowlist
        └── ssrf.ts        # assertSafeUrl + private CIDR sets
```

## Tool resolution flow

For each name in `blueprint.tools`:

1. `isInternalToolName(name)` → `buildInternalTool(name, ctx)`. Internal tools bypass the plugin registry; not overridable.
2. else `opts.plugins?.toolFor(name)` → `svc.build(ctx)`. Plugin-contributed tools.
3. else if `opts.plugins?.hasTool(name)` → claimed but disabled → warn + skip.
4. else warn + skip.

Auto-included tools are appended after the allowlist resolves: scripts (`blueprint.scripts`), MCP (`blueprint.connectors`), skill_load (`blueprint.skills`), report_status (`blueprint.outcomes`).

`ToolBuildContext` carries `{environment, blueprintDir, engine, onLog, plugins, secrets, state, envAllowedHosts, engineRequiredHosts}`. Internal tools use a subset; plugin dispatchers use the full context.

## Sandbox runtime contract

Internal tools run subprocesses inside the session so they inherit the run's sandbox + egress proxy. Every environment plugin MUST provide on PATH inside the session:

- `bun` — used by `javascript` (and `scripts.ts` for blueprint scripts via `bun run`).
- `python3` — used by `python`. `uv` works as an alternative if `pythonBin` is overridden to `"uv run python"` via engine config.
- `rg` (preferred) or `grep` — used by `grep`.
- coreutils (`test`, `mkdir`, `find`, `ls`, `head`).

`env-docker` default image ships these. `env-process` and `env-local-strict` rely on host PATH. `env-daytona` defaults to `ubuntu:24.04` (has `python3`; bun must be added at snapshot init).

## Why the split exists

`core/` used to mix types, parsers, AND agent runtime. The dashboard imports `@oddjob/core` for types only — but at runtime that pulled in agent code transitively. Splitting `agent/` out keeps `core/` browser-safe and lets future "remote dashboard" stories not bundle the agent.

`agent/` depends on `core/`, never the reverse. If a type currently lives in agent but core needs it, move the TYPE to core (leave the runtime function in agent). Example: `INTERNAL_TOOL_NAMES` + `EngineConfig` + `BuiltinToolsConfig` live in `core/src/types/internal-tools.ts` because blueprint validation needs them; the build functions stay in agent.

## Gotchas

- **No `buildBuiltinTools` / `buildSingleBuiltinTool` anymore.** Tests construct internal tools via `buildInternalTool(name, ctx)` directly.
- **`javascript_repl` / `python_repl` are renamed** to `javascript` / `python`. Validator throws an explicit "renamed to X" error if old names appear in a blueprint.
- **Inline `import("../path")` types** survive sed-based path rewrites less well than `from "..."` imports — use the bare-import form so future moves are mechanical.
- **Skills loader** uses Node `fs`. Keep `tools/skills.ts` (uses `LoadedSkill` type only) separate from `skills.ts` (the loader).
- **Per-tool wrappers in `tools/{bash,read,write,edit,find,ls,grep}.ts`** delegate to pi-coding-agent or `coding-adapter.ts`. Don't put logic there — extend `coding-adapter.ts` and re-route.
