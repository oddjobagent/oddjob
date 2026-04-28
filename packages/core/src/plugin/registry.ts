// Plugin registry: parallel maps per service kind, populated by the loader.
// Keep it tiny and side-effect-free so the dashboard package can import these
// types without dragging Bun built-ins.

import type {
  ChannelService,
  EnvironmentService,
  McpBundleService,
  ModelProviderService,
  Plugin,
  PluginRecord,
  PluginSource,
  SkillPackService,
  ToolService,
  WebFetchService,
  WebSearchService,
} from "./types.ts";

export interface RegisteredPlugin {
  record: PluginRecord;
  plugin: Plugin;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, RegisteredPlugin>();
  private readonly providers = new Map<string, ModelProviderService>();
  private readonly channels = new Map<string, ChannelService>();
  private readonly tools = new Map<string, ToolService>();
  private readonly mcpBundles = new Map<string, McpBundleService>();
  private readonly skillPacks = new Map<string, SkillPackService>();
  private readonly environments = new Map<string, EnvironmentService>();
  private readonly webSearches = new Map<string, WebSearchService>();
  private readonly webFetches = new Map<string, WebFetchService>();

  register(plugin: Plugin, source: PluginSource, installedAt = Date.now()): RegisteredPlugin {
    const slug = plugin.manifest.slug;
    if (this.plugins.has(slug)) {
      throw new Error(`plugin '${slug}' already registered`);
    }
    // Validate ALL services before mutating any registry map. This avoids
    // leaving the registry in a partial state when one service in a plugin
    // collides — the failed plugin must not appear in `list()` either.
    // Per-kind local Sets also catch intra-plugin duplicates that the global
    // map check would otherwise miss (each insert overwrites the prior).
    const localProviderIds = new Set<string>();
    const localEnvironmentIds = new Set<string>();
    for (const svc of plugin.services) {
      if (svc.kind === "model-provider") {
        if (this.providers.has(svc.id)) {
          throw new Error(
            `model provider '${svc.id}' already registered (from plugin '${this.findOwner("provider", svc.id) ?? "?"}')`,
          );
        }
        if (localProviderIds.has(svc.id)) {
          throw new Error(`model provider '${svc.id}' declared twice in plugin '${slug}'`);
        }
        localProviderIds.add(svc.id);
      }
      if (svc.kind === "environment") {
        if (this.environments.has(svc.id)) {
          throw new Error(
            `environment service '${svc.id}' already registered (from plugin '${this.findOwner("environment", svc.id) ?? "?"}')`,
          );
        }
        if (localEnvironmentIds.has(svc.id)) {
          throw new Error(`environment service '${svc.id}' declared twice in plugin '${slug}'`);
        }
        localEnvironmentIds.add(svc.id);
      }
    }
    const record: PluginRecord = {
      slug,
      version: plugin.manifest.version,
      source,
      enabled: true,
      manifest: plugin.manifest,
      installedAt,
    };
    const entry: RegisteredPlugin = { record, plugin };
    this.plugins.set(slug, entry);
    for (const svc of plugin.services) {
      switch (svc.kind) {
        case "model-provider":
          this.providers.set(svc.id, svc);
          break;
        // tool / channel / web-* services use last-wins so local plugins can
        // override bundled ones. CLI registers bundled plugins first, then
        // local — so a user's local `bash` tool replaces the bundled one.
        case "channel":
          this.channels.set(svc.type, svc);
          break;
        case "tool":
          this.tools.set(svc.name, svc);
          break;
        case "mcp-bundle":
          this.mcpBundles.set(slug, svc);
          break;
        case "skill-pack":
          this.skillPacks.set(slug, svc);
          break;
        case "environment":
          this.environments.set(svc.id, svc);
          break;
        case "web-search":
          this.webSearches.set(svc.id, svc);
          break;
        case "web-fetch":
          this.webFetches.set(svc.id, svc);
          break;
      }
    }
    return entry;
  }

  unregister(slug: string): void {
    const entry = this.plugins.get(slug);
    if (!entry) return;
    for (const svc of entry.plugin.services) {
      switch (svc.kind) {
        case "model-provider":
          if (this.providers.get(svc.id) === svc) this.providers.delete(svc.id);
          break;
        case "channel":
          if (this.channels.get(svc.type) === svc) this.channels.delete(svc.type);
          break;
        case "tool":
          if (this.tools.get(svc.name) === svc) this.tools.delete(svc.name);
          break;
        case "mcp-bundle":
          if (this.mcpBundles.get(slug) === svc) this.mcpBundles.delete(slug);
          break;
        case "skill-pack":
          if (this.skillPacks.get(slug) === svc) this.skillPacks.delete(slug);
          break;
        case "environment":
          if (this.environments.get(svc.id) === svc) this.environments.delete(svc.id);
          break;
        case "web-search":
          if (this.webSearches.get(svc.id) === svc) this.webSearches.delete(svc.id);
          break;
        case "web-fetch":
          if (this.webFetches.get(svc.id) === svc) this.webFetches.delete(svc.id);
          break;
      }
    }
    this.plugins.delete(slug);
  }

  list(): RegisteredPlugin[] {
    return [...this.plugins.values()];
  }

  get(slug: string): RegisteredPlugin | undefined {
    return this.plugins.get(slug);
  }

  /**
   * Find the owning plugin for a service. Used by the lookup helpers to filter
   * disabled plugins out of resolver paths.
   */
  private ownerOf(svc: object): RegisteredPlugin | undefined {
    for (const reg of this.plugins.values()) {
      if (reg.plugin.services.includes(svc as never)) return reg;
    }
    return undefined;
  }

  private isEnabled(svc: object): boolean {
    return this.ownerOf(svc)?.record.enabled === true;
  }

  providerFor(slug: string): ModelProviderService | undefined {
    const svc = this.providers.get(slug);
    return svc && this.isEnabled(svc) ? svc : undefined;
  }

  listProviders(): ModelProviderService[] {
    return [...this.providers.values()].filter((svc) => this.isEnabled(svc));
  }

  channelFor(type: string): ChannelService | undefined {
    const svc = this.channels.get(type);
    return svc && this.isEnabled(svc) ? svc : undefined;
  }

  toolFor(name: string): ToolService | undefined {
    const svc = this.tools.get(name);
    return svc && this.isEnabled(svc) ? svc : undefined;
  }

  /**
   * Whether ANY plugin (enabled or not) has claimed this tool name. Used by
   * the agent loop to distinguish "no plugin ever owned this name" from
   * "plugin owns this but is disabled" — only the former should fall back
   * to a direct builtin build.
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  environmentFor(id: string): EnvironmentService | undefined {
    const svc = this.environments.get(id);
    return svc && this.isEnabled(svc) ? svc : undefined;
  }

  listEnvironments(): EnvironmentService[] {
    return [...this.environments.values()].filter((svc) => this.isEnabled(svc));
  }

  webSearchFor(id: string): WebSearchService | undefined {
    const svc = this.webSearches.get(id);
    return svc && this.isEnabled(svc) ? svc : undefined;
  }

  listWebSearches(): WebSearchService[] {
    return [...this.webSearches.values()].filter((svc) => this.isEnabled(svc));
  }

  webFetchFor(id: string): WebFetchService | undefined {
    const svc = this.webFetches.get(id);
    return svc && this.isEnabled(svc) ? svc : undefined;
  }

  listWebFetches(): WebFetchService[] {
    return [...this.webFetches.values()].filter((svc) => this.isEnabled(svc));
  }

  /** All enabled MCP bundles across plugins, keyed by owning plugin slug. */
  listMcpBundles(): Array<{ pluginSlug: string; bundle: McpBundleService }> {
    return [...this.mcpBundles.entries()]
      .filter(([slug]) => this.plugins.get(slug)?.record.enabled === true)
      .map(([pluginSlug, bundle]) => ({ pluginSlug, bundle }));
  }

  /** Resolve a bundled MCP server descriptor by `<pluginSlug>:<entryName>`. */
  mcpBundleEntry(
    ref: string,
  ): { pluginSlug: string; entry: import("./types.ts").McpBundleEntry } | undefined {
    const idx = ref.indexOf(":");
    if (idx < 0) return undefined;
    const pluginSlug = ref.slice(0, idx);
    const entryName = ref.slice(idx + 1);
    if (this.plugins.get(pluginSlug)?.record.enabled !== true) return undefined;
    const bundle = this.mcpBundles.get(pluginSlug);
    if (!bundle) return undefined;
    const entry = bundle.servers.find((s) => s.name === entryName);
    return entry ? { pluginSlug, entry } : undefined;
  }

  setEnabled(slug: string, enabled: boolean): void {
    const entry = this.plugins.get(slug);
    if (!entry) return;
    entry.record.enabled = enabled;
    entry.record.disabledAt = enabled ? undefined : Date.now();
  }

  private findOwner(kind: "provider" | "environment", id: string): string | undefined {
    for (const [slug, entry] of this.plugins) {
      for (const svc of entry.plugin.services) {
        if (kind === "provider" && svc.kind === "model-provider" && svc.id === id) return slug;
        if (kind === "environment" && svc.kind === "environment" && svc.id === id) return slug;
      }
    }
    return undefined;
  }
}
