// @oddjob/sdk — author-side ergonomics for plugin authors.
//
// Re-exports the plugin contract from @oddjob/core and provides a builder
// helper. Plugin authors should depend ONLY on this package — never on
// @oddjob/core directly — so we can swap the underlying types later.

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
} from "@oddjob/core";

export { STANDARD_ROLES } from "@oddjob/core";

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
