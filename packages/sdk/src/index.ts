// @oddjob/sdk — author-side ergonomics for plugin AND blueprint authors.
//
// BROWSER-SAFE — pure types + tiny runtime helpers. Do NOT import Bun
// built-ins (`bun:sqlite`, `Bun.serve`, etc.) or node:* modules here.
// This package ships standalone so blueprint authors can `bun add
// @oddjob/sdk` and write `main.ts` against `defineRun` + `Context`
// without pulling the runtime.
//
// Re-exports the plugin contract from @oddjob/core and provides:
//   - `definePlugin` — builder for plugin authors (existing).
//   - `defineRun` — wrapper for script-mode blueprint authors (B2.2).
//   - `Context` — the surface a `main.ts` sees at runtime.
//   - `RetryableError` / `PermanentError` — control-flow errors.
//   - `IpcCall` / `IpcResponse` — wire format for the future Python port.

export type {
  Plugin,
  PluginManifest,
  PluginService,
  ModelProviderService,
  ChannelService,
  ChannelBuildContext,
  ToolService,
  ToolBuildContext,
  McpBundleService,
  McpBundleEntry,
  SkillPackService,
  SkillPackEntry,
  ModelInfo,
  ModelCapabilities,
  ModelRole,
  ModelListContext,
  ResolvedRoleModel,
  ProviderCredential,
  PluginLoadContext,
  EnvironmentService,
  EnvironmentServiceCapabilities,
  EnvironmentTrustTier,
  PackageManagerKind,
  WebSearchService,
  WebSearchResult,
  WebSearchOptions,
  WebFetchService,
  WebFetchResult,
  WebFetchOptions,
} from "@oddjob/core";

export { STANDARD_ROLES } from "@oddjob/core";

// ---------------------------------------------------------------------------
// Script-mode SDK surface (B2.2).
// ---------------------------------------------------------------------------

export { defineRun, isRunDefinition, ODDJOB_RUN_MARKER } from "./define-run.ts";
export type { DefineRunOptions, RunDefinition, RunFn } from "./define-run.ts";

export { assertSerial } from "./context.ts";
export type {
  Context,
  ForkOptions,
  McpHandle,
  MemoryNamespace,
  MemoryOptions,
  RunAgentOptions,
  ScratchNamespace,
  SerialDispatcher,
} from "./context.ts";

export { PermanentError, RetryableError } from "./errors.ts";
export type { RetryableErrorOptions } from "./errors.ts";

export { IPC_CALL_KINDS } from "./dispatch-protocol.ts";
export type {
  ApprovalArgs,
  ForkArgs,
  ForkResult,
  IpcCall,
  IpcCallKind,
  IpcErrorBody,
  IpcResponse,
  IpcResultMap,
  McpArgs,
  MemoryGetArgs,
  MemorySetArgs,
  NotifyArgs,
  RunAgentArgs,
  ScratchGetArgs,
  ScratchSetArgs,
  SleepArgs,
  ToolArgs,
  WaitForRunArgs,
} from "./dispatch-protocol.ts";

import type {
  ChannelService,
  EnvironmentService,
  McpBundleService,
  ModelProviderService,
  Plugin,
  PluginManifest,
  PluginService,
  SkillPackService,
  ToolService,
  WebFetchService,
  WebSearchService,
} from "@oddjob/core";

export interface DefinePluginManifestInput {
  slug: string;
  name?: string;
  description?: string;
  version: string;
  author?: string;
  homepage?: string;
  icon?: string;
  /** Engine semver range. Defaults to "*" (any). */
  engine?: string;
}

export interface PluginBuilder {
  modelProvider(svc: Omit<ModelProviderService, "kind">): void;
  channel(svc: Omit<ChannelService, "kind">): void;
  tool(svc: Omit<ToolService, "kind">): void;
  mcpBundle(svc: Omit<McpBundleService, "kind">): void;
  skillPack(svc: Omit<SkillPackService, "kind">): void;
  environment(svc: Omit<EnvironmentService, "kind">): void;
  webSearch(svc: Omit<WebSearchService, "kind">): void;
  webFetch(svc: Omit<WebFetchService, "kind">): void;
}

/**
 * Build a Plugin via a small builder. The default export of any plugin
 * module should be the result of this call.
 *
 * @example
 *   export default definePlugin(
 *     { slug: "openai", version: "0.1.0", description: "OpenAI provider" },
 *     (b) => b.modelProvider({ id: "openai", ... }),
 *   );
 */
export function definePlugin(
  manifest: DefinePluginManifestInput,
  build: (b: PluginBuilder) => void,
  hooks: { onLoad?: Plugin["onLoad"]; onUnload?: Plugin["onUnload"] } = {},
): Plugin {
  const services: PluginService[] = [];
  const builder: PluginBuilder = {
    modelProvider: (svc) => {
      services.push({ kind: "model-provider", ...svc });
    },
    channel: (svc) => {
      services.push({ kind: "channel", ...svc });
    },
    tool: (svc) => {
      services.push({ kind: "tool", ...svc });
    },
    mcpBundle: (svc) => {
      services.push({ kind: "mcp-bundle", ...svc });
    },
    skillPack: (svc) => {
      services.push({ kind: "skill-pack", ...svc });
    },
    environment: (svc) => {
      services.push({ kind: "environment", ...svc });
    },
    webSearch: (svc) => {
      services.push({ kind: "web-search", ...svc });
    },
    webFetch: (svc) => {
      services.push({ kind: "web-fetch", ...svc });
    },
  };
  build(builder);
  const full: PluginManifest = {
    slug: manifest.slug,
    name: manifest.name ?? manifest.slug,
    description: manifest.description ?? "",
    version: manifest.version,
    author: manifest.author,
    homepage: manifest.homepage,
    icon: manifest.icon,
    oddjob: { engine: manifest.engine ?? "*" },
  };
  return { manifest: full, services, ...hooks };
}
