// Oddjob plugin contract.
//
// A plugin is a single ES module that default-exports a `Plugin` object built
// via `definePlugin()` from `@oddjob/sdk`. Plugins ship one or more services
// (model providers, channels, tools, MCP server bundles, skill packs).
// Loaded from two sources: bundled (static imports compiled into the binary)
// and side-loaded from `~/.oddjob/plugins/<slug>/`.

export interface PluginManifest {
  /** Unique kebab-case identifier. e.g. "openai", "slack-channels". */
  slug: string;
  name: string;
  description: string;
  /** semver. */
  version: string;
  author?: string;
  homepage?: string;
  /** https:// URL or `data:image/svg+xml;base64,...`. */
  icon?: string;
  /** Engine compat range the plugin claims. semver range string. */
  oddjob: { engine: string };
}

/** Where a plugin came from. */
export type PluginSource = "bundled" | "local" | "npm";

/** Persisted record describing an installed plugin. */
export interface PluginRecord {
  slug: string;
  version: string;
  source: PluginSource;
  enabled: boolean;
  manifest: PluginManifest;
  configJson?: string;
  installedAt: number;
  disabledAt?: number;
}

/** Where a config row came from. */
export type ConfigSource = "config" | "dashboard";

/** Stored credential for a model-provider service. */
export interface ProviderCredentialRecord {
  providerSlug: string;
  credentialName: string;
  /** Secret name in the SecretsProvider that holds the API key. */
  apiKeySecret?: string;
  /** Inline options JSON (baseUrl, organizationId, etc). */
  optionsJson?: string;
  source: ConfigSource;
  createdAt: number;
  updatedAt: number;
}

/** Resolved credential ready to be passed to a provider's createClient. */
export interface ProviderCredential {
  apiKey?: string;
  baseUrl?: string;
  options?: Record<string, unknown>;
}

/** Engine-level role assignment row. */
export interface EngineModelRoleRecord {
  role: string;
  providerSlug: string;
  modelId: string;
  credentialName: string;
  optionsJson?: string;
  source: ConfigSource;
  updatedAt: number;
}

export interface ModelCatalogRecord {
  providerSlug: string;
  modelId: string;
  data: ModelInfo;
  fetchedAt: number;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutput: number;
  /** USD per 1M input tokens. */
  inputCostPerMillion: number;
  /** USD per 1M output tokens. */
  outputCostPerMillion: number;
  /** USD per 1M cached input tokens. */
  cachedInputCostPerMillion?: number;
  supports: ModelCapabilities;
  /** Family grouping for UI ("claude", "gpt-4", "gemini"). */
  family?: string;
  /** ISO date string. Marks the model as deprecated in the UI. */
  deprecatedAt?: string;
}

export interface ModelCapabilities {
  tools: boolean;
  streaming: boolean;
  vision: boolean;
  reasoning: boolean;
}

/**
 * Roles known at v1. Custom strings allowed (extensible by users) but the
 * runtime only resolves these three by default.
 */
export type ModelRole = "default" | "advisor" | "grader" | (string & {});

export const STANDARD_ROLES: readonly ModelRole[] = ["default", "advisor", "grader"] as const;

// Service variants -----------------------------------------------------------

export type PluginService =
  | ModelProviderService
  | ChannelService
  | ToolService
  | McpBundleService
  | SkillPackService
  | EnvironmentService
  | WebSearchService
  | WebFetchService;

/** Context passed to listModels / refreshCatalog. */
export interface ModelListContext {
  credential?: ProviderCredential;
  /** Abort signal for catalog refresh fetches. */
  signal?: AbortSignal;
}

/** Result of resolving a model role to a concrete pi-ai model. */
export interface ResolvedRoleModel {
  /** pi-ai Model<Api> instance, ready for streamSimple/runAgentLoop. */
  model: import("@mariozechner/pi-ai").Model<import("@mariozechner/pi-ai").Api>;
  apiKey?: string;
  /** Catalog entry the model was resolved against, if available. */
  info?: ModelInfo;
}

export interface ModelProviderService {
  kind: "model-provider";
  /** Stable provider id; matches manifest.slug for single-service plugins. */
  id: string;
  displayName: string;
  /** What capabilities this provider's API supports in general. */
  capabilities: ModelCapabilities;
  /** Free-text describing what credentials are required. UI hint. */
  authHint?: string;
  /** Lookup a single model by id from the bundled catalog (sync, no I/O). */
  listModels(): readonly ModelInfo[];
  /**
   * Optional live-fetch from the provider's /models endpoint. When omitted,
   * the bundled list is authoritative. Implementations should NOT throw — on
   * failure return the bundled list and let the caller log.
   */
  refreshCatalog?(ctx: ModelListContext): Promise<readonly ModelInfo[]>;
  /**
   * Build a pi-ai Model + apiKey suitable for runAgentLoop, given a
   * resolved credential (api key + options) and the model id selected by
   * the engine role.
   */
  createClient(modelId: string, credential: ProviderCredential): ResolvedRoleModel;
}

/** Build context passed to ChannelService.create. */
export interface ChannelBuildContext {
  secrets?: import("../providers/secrets.ts").SecretsProvider;
}

export interface ChannelService {
  kind: "channel";
  /** Channel type matched against ChannelConfig.type (e.g. "console", "slack"). */
  type: string;
  /** Human label for UI. Optional; defaults to capitalized `type`. */
  displayName?: string;
  /** Build a ChannelProvider. Called once per registry resolve. */
  create: (ctx: ChannelBuildContext) => import("../providers/channel.ts").ChannelProvider;
}

/** Build context passed to ToolService.build. */
export interface ToolBuildContext {
  environment: import("../providers/environment.ts").EnvironmentSession;
  blueprintDir: string;
  engine?: import("../types/builtin-tools.ts").EngineConfig;
  onLog?: (entry: import("../providers/logging.ts").LogEntry) => void;
  /**
   * Plugin registry — passed so a plugin-built tool (e.g. web_fetch) can
   * dispatch through registered WebFetchService / WebSearchService backends
   * instead of the legacy embedded providers.
   */
  plugins?: import("./registry.ts").PluginRegistry;
  /**
   * Secrets provider — used by web_search / web_fetch dispatchers to resolve
   * `provider_credentials` rows for the configured backend plugin. Optional;
   * tests omit it.
   */
  secrets?: import("../providers/secrets.ts").SecretsProvider;
  /** State provider — used to look up current `provider_credentials` rows. */
  state?: import("../providers/state.ts").StateProvider;
  /**
   * Hosts the surrounding environment permits egress to. Set when the env's
   * networking is `"limited"`; left undefined for unrestricted envs. When
   * defined, web_fetch + web_search refuse to dispatch to hosts outside the
   * union of `envAllowedHosts ∪ engineRequiredHosts`.
   */
  envAllowedHosts?: readonly string[];
  /**
   * Hosts the engine itself must reach (LLM provider base URL + declared MCP
   * server hostnames). Always permitted alongside `envAllowedHosts`.
   */
  engineRequiredHosts?: readonly string[];
}

// EnvironmentService -------------------------------------------------------

/** Trust posture of the environment's session. Surfaced as a dashboard badge. */
export type EnvironmentTrustTier = "trusted" | "local-strict" | "container" | "remote-vm";

/** Package managers an environment can prepare. Drives EnvironmentConfig.packages compatibility. */
export type PackageManagerKind = "apt" | "cargo" | "gem" | "go" | "npm" | "pip";

/** Per-service capability flags surfaced to the dashboard for UI affordances. */
export interface EnvironmentServiceCapabilities {
  snapshot: boolean;
  fork: boolean;
  pauseResume: boolean;
  exposePort: boolean;
  /** Provider enforces its own egress allowlist (vs. relying on the proxy). */
  egressAllowlist: boolean;
  packageManagers: readonly PackageManagerKind[];
}

/**
 * Plugin-contributed environment backend. Parallel to ModelProviderService:
 * the plugin loader registers one service per environment id; the runtime
 * looks it up by id when resolving an Environment record's
 * `config.provider.service` field.
 */
export interface EnvironmentService {
  kind: "environment";
  /** Stable id; matches the value used in EnvironmentConfig.provider.service. */
  id: string;
  displayName: string;
  trustTier: EnvironmentTrustTier;
  /**
   * Zod schema describing the credential shape this service expects (e.g.
   * `z.object({ apiKey: z.string() })` for Daytona). The dashboard's credential
   * editor renders form fields from this schema. Omit for local services that
   * take no credential.
   *
   * Typed loosely as `unknown` here so `@oddjob/core` does not depend on Zod
   * at the type level — plugins import zod themselves and pass a `z.ZodType`.
   */
  authSchema?: unknown;
  /** Optional free-text hint shown alongside the credential form. */
  authHint?: string;
  capabilities: EnvironmentServiceCapabilities;
  /**
   * Liveness check called by `oddjob setup` and the dashboard's providers
   * page. Should NOT throw — return `{ ok: false, reason }` on failure.
   * Examples: `which sandbox-exec`, `which bwrap`, `docker info`, Daytona ping.
   */
  available(): Promise<{ ok: boolean; reason?: string }>;
  /**
   * Construct the EnvironmentProvider. Bundled local services ignore the
   * credential argument; remote services (Daytona, E2B, ...) use it for the
   * API key + options.
   */
  create(
    credential?: ProviderCredential,
  ): import("../providers/environment.ts").EnvironmentProvider;
}

export interface ToolService {
  kind: "tool";
  /** Tool name as it appears in blueprint.tools allowlist. */
  name: string;
  /** Build the AgentTool when allowlisted by a blueprint. */
  build: (
    ctx: ToolBuildContext,
  ) => import("@mariozechner/pi-agent-core").AgentTool<import("typebox").TSchema>;
}

/** Descriptor for a single MCP server shipped by a plugin. */
export interface McpBundleEntry {
  name: string;
  description?: string;
  /** Stdio or HTTP descriptor matching `Connector` shape from blueprint connectors. */
  descriptor: import("../types/connector.ts").Connector;
}

export interface McpBundleService {
  kind: "mcp-bundle";
  servers: ReadonlyArray<McpBundleEntry>;
}

export interface SkillPackEntry {
  name: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface SkillPackService {
  kind: "skill-pack";
  skills: ReadonlyArray<SkillPackEntry>;
}

// Web search ---------------------------------------------------------------

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Optional extra metadata (publishedAt, score, source) — provider-specific. */
  meta?: Record<string, unknown>;
}

export interface WebSearchOptions {
  maxResults?: number;
  signal?: AbortSignal;
  /** Test seam — production code passes through to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface WebSearchService {
  kind: "web-search";
  /** Stable id; matches manifest.slug for single-service plugins. */
  id: string;
  displayName: string;
  /** Free-text describing required credentials. UI hint. */
  authHint?: string;
  /**
   * Run a search and return ranked results. Implementations should NOT throw
   * for "no results" — return `[]`. Throw for transport / auth errors.
   */
  search(
    query: string,
    credential: ProviderCredential,
    opts?: WebSearchOptions,
  ): Promise<readonly WebSearchResult[]>;
  /**
   * Return the EXACT hostname the provider will contact for the given
   * credential. The web_search dispatcher calls this BEFORE `search()` and
   * gates against the env's egress allowlist using the returned host. Must
   * mirror whatever fallback logic `search()` uses internally (default URL
   * when `credential.options.baseUrl` is absent, etc.).
   *
   * Return `undefined` when the host cannot be determined (e.g. self-hosted
   * provider with no baseUrl configured) — the dispatcher fails closed.
   */
  resolveHost(credential: ProviderCredential): string | undefined;
}

// Web fetch ----------------------------------------------------------------

export interface WebFetchOptions {
  /** Cap on response body size in bytes. Provider should truncate + flag. */
  maxBytes?: number;
  /** Whether to render JS (browser-based fetchers only). */
  renderJs?: boolean;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /**
   * Per-hop URL validator. The dispatcher injects this so every redirect
   * Location target is re-checked against the SSRF + env-egress gates BEFORE
   * the fetcher follows it. Implementations MUST `await validateUrl(target)`
   * for the initial URL AND every redirect; the validator throws when the
   * target is rejected (callers should let the error propagate). Optional
   * for backwards compat — when undefined, the fetcher skips per-hop checks
   * and trusts the dispatcher's pre-flight validation only.
   */
  validateUrl?: (url: string) => Promise<void>;
}

export interface WebFetchResult {
  /** URL after redirects. */
  finalUrl: string;
  status: number;
  /** Response content as text (markdown if the provider does HTML→md). */
  body: string;
  /** Format the body is in. */
  format: "markdown" | "html" | "text" | "json";
  truncated: boolean;
  /** Optional extra metadata (title, screenshot URL, ...) — provider-specific. */
  meta?: Record<string, unknown>;
}

export interface WebFetchService {
  kind: "web-fetch";
  id: string;
  displayName: string;
  authHint?: string;
  /**
   * Whether this backend honours `WebFetchOptions.validateUrl` on every
   * redirect hop. `true` only for backends that follow redirects in-process
   * (raw). Managed/SaaS scrapers (browserbase, firecrawl, scrapingbee, etc.)
   * delegate redirect-following to their upstream service and CANNOT enforce
   * the per-hop gate — they should set this to `false`. The `web_fetch`
   * dispatcher refuses to use a backend with `supportsRedirectValidation:
   * false` when the surrounding env declares `networking.type === "limited"`,
   * because allowing it would re-open the redirect-bypass class. Defaults
   * to `false` for safety when omitted.
   */
  supportsRedirectValidation?: boolean;
  /**
   * Fetch a URL. Implementations should respect SSRF guard policy at the
   * call site (the dispatcher tool enforces it before reaching here).
   */
  fetch(
    url: string,
    credential: ProviderCredential,
    opts?: WebFetchOptions,
  ): Promise<WebFetchResult>;
}

// The plugin object itself ---------------------------------------------------

export interface PluginLoadContext {
  /** Where this plugin was loaded from. */
  source: PluginSource;
  /** Absolute directory the plugin was loaded from (for local/npm). Empty for bundled. */
  dir: string;
}

export interface Plugin {
  manifest: PluginManifest;
  services: readonly PluginService[];
  /** Optional — called once after services are registered. */
  onLoad?: (ctx: PluginLoadContext) => Promise<void> | void;
  /** Optional — called on graceful shutdown. */
  onUnload?: () => Promise<void> | void;
}
