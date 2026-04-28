# plugins/

Concrete provider/tool/channel/llm implementations. Bundled at build time (CLI imports each + registers via `registerBundled`); installable from `~/.oddjob/plugins/` via `loadLocalPlugins`.

## Inventory (post April 2026 re-arch)

### Tools (4 bundles)
- `tools-core` — bash, read, write, edit, grep, find, ls, datetime. One .ts per tool registering `b.tool({name, build})`. Build delegates to `buildSingleBuiltinTool(name, ctx)` from `@oddjob/agent`.
- `tools-coding` — python_repl, javascript_repl. Subprocess REPLs (system python3 / `bun -e`); WASM REPLs broken on Bun.
- `tools-web-fetch` — `web_fetch` tool + 4 backends (raw, browserbase, firecrawl, scrapingbee). Backend selected via engine config `[builtin_tools.web_fetch] plugin = "..."`.
- `tools-web-search` — `web_search` tool + 5 providers (brave, tavily, searxng, exa, serpapi).

### Model providers (2)
- `pi-models` — single plugin registering a `ModelProviderService` for every pi-ai built-in provider (~25 providers, ~880 models). Replaces the deleted plugin-{anthropic,openai,openrouter} trio. `createClient` delegates to `pi-ai.getModel`; passthrough providers (openrouter, vercel-ai-gateway, huggingface, fireworks, opencode, opencode-go) synthesise a Model when pi-ai's registry lacks the id (uses the provider's exemplar to pick api + baseUrl).
- `llama-local` — Ollama / LM Studio (OpenAI-compatible local endpoint). Kept separate because it isn't in pi-ai's registry and has a distinct local-endpoint default (`http://127.0.0.1:11434/v1`).

### Channels (5)
- `channels-core` — meta-bundle that re-registers console / slack / email / webhook in one plugin. Each individual `channel-{console,slack,email,webhook}` plugin still ships independently for users who want them à la carte.

### Environments (4)
- `env-process` — Bun.spawn + tempdir. Trusted-local only.
- `env-docker` — container per Run with workdir bind-mount.
- `env-daytona` — Daytona Firecracker remote VMs (snapshot/fork/preview-URL caps).
- `env-local-strict` — seatbelt (macOS) / bwrap (Linux) / appcontainer (Windows) OS-level sandboxing.

### Stores + supporting providers
- `state-sqlite`, `queue-sqlite`, `queue-memory`, `secrets-sqlite`, `logging-sqlite` — SQLite-backed providers with embedded migrations.
- `scheduler-croner` — croner-based cron triggers with `protect: true` (no overlaps).
- `mcp-client` — stdio + Streamable HTTP + SSE + OAuth lifecycle.
- `auth-local` — OAuth lifecycle for MCP reauth.
- `storage-local` — stub (Phase 13+).
- `llm-pi` — pi-ai bridge (used by server's `Runtime.llm`; provides the actual stream/chat). Distinct from `pi-models` — `llm-pi` is the *provider implementation* (called per Run), `pi-models` is the *plugin* that registers ModelProviderServices for the registry.

## Plugin author conventions

- Each plugin: `package.json` with `@oddjob/plugin-<slug>` name, `tsconfig.json` extending `../../tsconfig.base.json` (note: 2 levels up — was 3 in the old packages/providers location), `oddjob-plugin.toml` with matching slug, `src/index.ts` exporting `definePlugin({slug, name, ...}, builder)` as default.
- Tool plugins: each tool gets its own .ts file exporting `Omit<ToolService, "kind">`. The plugin's index.ts calls `b.tool(toolDescriptor)`.
- Model providers: register via `b.modelProvider({id, listModels, createClient, ...})`. Multiple `b.modelProvider` calls per plugin are fine (pi-models registers ~25); use `PluginRegistry.ownerOfProvider(id)` from server-side code to walk back to the owning plugin slug.

## Plugin registry semantics (post Phase H)

- Last-wins registration for tool/channel/web-* services. Local plugins override bundled by registering second.
- Tool resolution at run time: `plugins.toolFor(name)` first; fall back to `buildSingleBuiltinTool` only when `plugins.hasTool(name)` is false (no plugin claimed the name). Disabled plugins honor disable.
- Don't iterate `BUILTIN_TOOL_NAMES` directly in new plugins — the registry is the source of truth. The constant remains in `core/types/builtin-tools.ts` for blueprint validation only.

## Gotchas

- **`oddjob-plugin.toml` slug** must match the slug passed to `definePlugin`. Local-plugin loader cross-checks. Phase C3 and Phase D both shipped with stale TOML slugs caught by codex review — easy to miss when renaming.
- **tsconfig depth** — plugins/<name>/tsconfig.json extends `../../tsconfig.base.json`. The old `packages/providers/<name>/tsconfig.json` extended `../../../tsconfig.base.json`. Per-package `bun run typecheck` fails if depth is wrong.
- **pi-ai cost is per-million tokens, not per-token.** Don't multiply by 1_000_000 when bridging Model.cost → ModelInfo.inputCostPerMillion. See memory `project_typebox_patterns`.
- **Custom baseUrl on a known model:** preserve registry's api kind, override only baseUrl. Don't synthesise (would silently switch Anthropic from anthropic-messages to openai-completions).
