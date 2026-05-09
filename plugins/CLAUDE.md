# plugins/

Concrete provider/tool/channel/llm implementations. Bundled at build time (CLI imports each + registers via `registerBundled`); installable from `~/.oddjob/plugins/` via `loadLocalPlugins`.

## Inventory (post April 2026 re-arch)

### Tools (2 bundles)

- `tools-web-fetch` — `web_fetch` tool (real dispatcher) + 4 backends (raw, browserbase, firecrawl, scrapingbee). Backend selected via engine config `[builtin_tools.web_fetch] plugin = "..."`. Backends import SSRF + egress utilities from `@oddjob/agent`.
- `tools-web-search` — `web_search` tool (real dispatcher) + 5 providers (brave, tavily, searxng, exa, serpapi).

**Internal tools** (bash, read, write, edit, grep, find, ls, datetime, javascript, python) ship inside `@oddjob/agent` (`packages/agent/src/tools/`). They are NOT plugins; they bypass the registry and are not overridable. The previous `tools-core` and `tools-coding` shim plugins are gone — pure-shim plugins were a backwards-compat artifact for hypothetical external `@oddjob/agent` consumers, and we have none.

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
- `llm-pi` — pi-ai bridge (used by server's `Runtime.llm`; provides the actual stream/chat). Distinct from `pi-models` — `llm-pi` is the _provider implementation_ (called per Run), `pi-models` is the _plugin_ that registers ModelProviderServices for the registry.

## Plugin author conventions

- Each plugin: `package.json` with `@oddjob/plugin-<slug>` name, `tsconfig.json` extending `../../tsconfig.base.json` (note: 2 levels up — was 3 in the old packages/providers location), `oddjob-plugin.toml` with matching slug, `src/index.ts` exporting `definePlugin({slug, name, ...}, builder)` as default.
- Tool plugins: each tool gets its own .ts file exporting `Omit<ToolService, "kind">`. The plugin's index.ts calls `b.tool(toolDescriptor)`.
- Model providers: register via `b.modelProvider({id, listModels, createClient, ...})`. Multiple `b.modelProvider` calls per plugin are fine (pi-models registers ~25); use `PluginRegistry.ownerOfProvider(id)` from server-side code to walk back to the owning plugin slug.

## Plugin registry semantics (post Phase J)

- Internal tools (bash, read, write, edit, grep, find, ls, datetime, javascript, python) are dispatched directly by `runOnce` via `buildInternalTool`. They do NOT go through the registry and are NOT overridable by plugins.
- Plugin-contributed tool/channel/web-\* services use last-wins registration. Local plugins override bundled by registering second.
- Tool resolution at run time: `isInternalToolName(name)` first → internal direct; else `plugins.toolFor(name)` → service if enabled; else `plugins.hasTool(name)` → warn + skip (disabled); else warn + skip.
- Plugin tool names available for blueprint validation: `registry.allToolNames()` returns the names of enabled plugin-contributed tools.

## Gotchas

- **`oddjob-plugin.toml` slug** must match the slug passed to `definePlugin`. Local-plugin loader cross-checks. Phase C3 and Phase D both shipped with stale TOML slugs caught by codex review — easy to miss when renaming.
- **tsconfig depth** — plugins/<name>/tsconfig.json extends `../../tsconfig.base.json`. The old `packages/providers/<name>/tsconfig.json` extended `../../../tsconfig.base.json`. Per-package `bun run typecheck` fails if depth is wrong.
- **pi-ai cost is per-million tokens, not per-token.** Don't multiply by 1_000_000 when bridging Model.cost → ModelInfo.inputCostPerMillion. See memory `project_typebox_patterns`.
- **Custom baseUrl on a known model:** preserve registry's api kind, override only baseUrl. Don't synthesise (would silently switch Anthropic from anthropic-messages to openai-completions).
