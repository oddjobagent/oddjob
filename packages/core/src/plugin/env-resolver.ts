// Resolves the effective Environment for a Run via a cascade:
//
//   1. inline only      — deployment.environmentInline (no environmentId)
//   2. ref + override   — deployment.environmentId + optional inline merge
//   3. engine default   — engine_settings.default_environment_id
//   4. hard default     — caller-supplied fallback (typically "default")
//
// The merge between a referenced env and an inline override is shallow per
// EnvironmentConfig key, except `networking.allowedHosts` which is concat-merged
// + deduped so engine-level required hosts (LLM provider) stay reachable.

import type {
  Environment,
  EnvironmentConfig,
  EnvironmentProviderRef,
} from "../types/environment.ts";

import type { PluginRegistry } from "./registry.ts";
import type { EnvironmentService } from "./types.ts";
import type { EnvironmentProvider } from "../providers/environment.ts";
import type { ProviderCredential, ProviderCredentialRecord } from "./types.ts";

export class EnvironmentNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`environment '${id}' not found`);
    this.name = "EnvironmentNotFoundError";
  }
}

export class EnvironmentServiceNotRegisteredError extends Error {
  constructor(public readonly serviceId: string) {
    super(`environment service '${serviceId}' is not registered`);
    this.name = "EnvironmentServiceNotRegisteredError";
  }
}

export class NoEnvironmentResolvedError extends Error {
  constructor() {
    super(
      "no environment could be resolved for this run: no inline body, no environment_id, no engine default, no hard default",
    );
    this.name = "NoEnvironmentResolvedError";
  }
}

export interface ResolvedEnvironment {
  /** Effective EnvironmentConfig after cascade + merge. */
  config: EnvironmentConfig;
  /** Which EnvironmentService was selected (may be the engine fallback). */
  service: EnvironmentService;
  /** Constructed provider, ready for `provider.spawn(...)`. */
  provider: EnvironmentProvider;
  /** Source of the resolution, for logging/auditing. */
  source: "inline" | "deployment-ref" | "engine-default" | "hard-default";
  /** The Environment record referenced (if any) before inline merge. */
  envRecord?: Environment;
}

export interface ResolveEnvironmentOptions {
  deployment: {
    environmentId?: string;
    environmentInline?: EnvironmentConfigInlineOverride;
  };
  /** Lookup by id; typically `state.getEnvironment(id)`. */
  getEnvironment: (id: string) => Promise<Environment | null>;
  /** Engine-level default environment id (engine_settings). */
  engineDefaultId?: string;
  /** Hard fallback id (auto-created at `oddjob setup`). */
  hardDefaultId?: string;
  registry: PluginRegistry;
  /**
   * Resolve a provider credential by `(providerSlug, credentialName)`. Used
   * when `EnvironmentConfig.provider.credential` is set. Optional — bundled
   * local providers ignore credentials.
   */
  getCredential?: (
    providerSlug: string,
    credentialName: string,
  ) => Promise<ProviderCredentialRecord | null>;
  /**
   * Resolve a credential's secret value (apiKey). Optional partner to
   * `getCredential` — secrets-sqlite reads it. Only required when the
   * credential row stores `apiKeySecret`.
   */
  getSecret?: (name: string) => Promise<string | undefined>;
  /**
   * Engine-level fallback EnvironmentService when the resolved env config
   * doesn't pin a `provider.service`. Typically the same as the hard-default
   * env's provider. Optional — when absent and config has no provider, the
   * resolver throws.
   */
  fallbackServiceId?: string;
}

export async function resolveEnvironment(
  opts: ResolveEnvironmentOptions,
): Promise<ResolvedEnvironment> {
  const inline = opts.deployment.environmentInline;
  const refId = opts.deployment.environmentId;

  // 1+2: deployment-level (inline alone, ref alone, or ref+inline merge)
  if (inline || refId) {
    let envRecord: Environment | undefined;
    let baseConfig: Partial<EnvironmentConfig> | undefined;
    if (refId) {
      envRecord = (await opts.getEnvironment(refId)) ?? undefined;
      if (!envRecord) throw new EnvironmentNotFoundError(refId);
      baseConfig = envRecord.config;
    }
    const merged = mergeConfigs(baseConfig, inline);
    if (!merged.type) {
      // Referenced envs always set type; pure-inline must too unless we
      // assume a default. Be strict — easier to relax than tighten.
      throw new Error(
        "environment config requires `type` ('local' or 'cloud'); set it inline or reference an env that does",
      );
    }
    return finalize(
      merged as EnvironmentConfig,
      opts,
      refId ? "deployment-ref" : "inline",
      envRecord,
    );
  }

  // 3: engine default
  if (opts.engineDefaultId) {
    const envRecord = await opts.getEnvironment(opts.engineDefaultId);
    if (!envRecord) throw new EnvironmentNotFoundError(opts.engineDefaultId);
    return finalize(envRecord.config, opts, "engine-default", envRecord);
  }

  // 4: hard default
  if (opts.hardDefaultId) {
    const envRecord = await opts.getEnvironment(opts.hardDefaultId);
    if (!envRecord) throw new EnvironmentNotFoundError(opts.hardDefaultId);
    return finalize(envRecord.config, opts, "hard-default", envRecord);
  }

  throw new NoEnvironmentResolvedError();
}

async function finalize(
  config: EnvironmentConfig,
  opts: ResolveEnvironmentOptions,
  source: ResolvedEnvironment["source"],
  envRecord?: Environment,
): Promise<ResolvedEnvironment> {
  const serviceId = config.provider?.service ?? opts.fallbackServiceId;
  if (!serviceId) {
    throw new Error(
      "environment config has no provider.service and no engine fallback was provided",
    );
  }
  const service = opts.registry.environmentFor(serviceId);
  if (!service) throw new EnvironmentServiceNotRegisteredError(serviceId);

  let credential: ProviderCredential | undefined;
  if (config.provider?.credential && opts.getCredential) {
    const credRow = await opts.getCredential(serviceId, config.provider.credential);
    if (credRow) {
      let apiKey: string | undefined;
      if (credRow.apiKeySecret && opts.getSecret) {
        apiKey = await opts.getSecret(credRow.apiKeySecret);
      }
      const options = credRow.optionsJson
        ? (JSON.parse(credRow.optionsJson) as Record<string, unknown>)
        : undefined;
      credential = {
        apiKey,
        baseUrl: typeof options?.baseUrl === "string" ? (options.baseUrl as string) : undefined,
        options,
      };
    }
  }

  const provider = service.create(credential);
  return { config, service, provider, source, envRecord };
}

/**
 * Inline override shape for `mergeConfigs`. Loosens `provider` so a
 * deployment can override only the credential while inheriting the service
 * from the referenced environment.
 */
export type EnvironmentConfigInlineOverride = Omit<Partial<EnvironmentConfig>, "provider"> & {
  provider?: Partial<EnvironmentProviderRef>;
};

/**
 * Shallow merge of an inline override on top of a base config. Most fields
 * replace key-by-key; `networking.allowedHosts` is concat-deduped so engine-
 * level required hosts stay reachable.
 */
export function mergeConfigs(
  base: Partial<EnvironmentConfig> | undefined,
  inline: EnvironmentConfigInlineOverride | undefined,
): Partial<EnvironmentConfig> {
  if (!base && !inline) return {};
  if (!base) {
    // Pure-inline path: provider must be a fully-formed EnvironmentProviderRef.
    const out: Partial<EnvironmentConfig> = { ...inline } as Partial<EnvironmentConfig>;
    if (inline?.provider && !inline.provider.service) {
      // No base to inherit from; drop the partial provider.
      delete out.provider;
    }
    return out;
  }
  if (!inline) return { ...base };
  const merged: Partial<EnvironmentConfig> = { ...base };
  if (inline.type !== undefined) merged.type = inline.type;
  if (inline.image !== undefined) merged.image = inline.image;
  if (inline.workingDir !== undefined) merged.workingDir = inline.workingDir;
  if (inline.template !== undefined) merged.template = inline.template;
  if (inline.packages !== undefined)
    merged.packages = mergePackages(base.packages, inline.packages);
  if (inline.resources !== undefined)
    merged.resources = mergeResources(base.resources, inline.resources);
  if (inline.provider !== undefined) {
    const p = mergeProvider(base.provider, inline.provider);
    if (p) merged.provider = p;
  }
  if (inline.networking !== undefined)
    merged.networking = mergeNetworking(base.networking, inline.networking);
  return merged;
}

/**
 * Per-key provider merge. Inline service falls back to base; inline credential
 * falls back to base. If neither has a service, returns undefined (caller
 * uses fallbackServiceId).
 */
function mergeProvider(
  base: EnvironmentProviderRef | undefined,
  inline: Partial<EnvironmentProviderRef>,
): EnvironmentProviderRef | undefined {
  const service = inline.service ?? base?.service;
  if (!service) return undefined;
  return {
    service,
    credential: inline.credential ?? base?.credential,
  };
}

/**
 * Per-package-manager merge. Inline arrays REPLACE the base array for that
 * manager (npm replaces npm, apt replaces apt). Missing keys in inline fall
 * through to base. This matches the spec's "key-by-key object merge".
 */
function mergePackages(
  base: EnvironmentConfig["packages"],
  inline: EnvironmentConfig["packages"],
): EnvironmentConfig["packages"] {
  if (!base) return inline;
  if (!inline) return base;
  return { ...base, ...inline };
}

/**
 * Per-field resource merge. Inline values replace base for that key only.
 */
function mergeResources(
  base: EnvironmentConfig["resources"],
  inline: EnvironmentConfig["resources"],
): EnvironmentConfig["resources"] {
  if (!base) return inline;
  if (!inline) return base;
  return { ...base, ...inline };
}

function mergeNetworking(
  base: EnvironmentConfig["networking"],
  inline: EnvironmentConfig["networking"],
): EnvironmentConfig["networking"] {
  if (!base) return inline;
  if (!inline) return base;
  // Type change wins; otherwise preserve type and concat allowedHosts.
  if (inline.type !== base.type) return inline;
  if (inline.type === "unrestricted") return inline;
  const baseLimited = base as Extract<EnvironmentConfig["networking"], { type: "limited" }>;
  const inlineLimited = inline;
  const allowedHosts = Array.from(
    new Set([...(baseLimited.allowedHosts ?? []), ...(inlineLimited.allowedHosts ?? [])]),
  );
  return {
    type: "limited",
    allowedHosts,
    allowMcpServers: inlineLimited.allowMcpServers ?? baseLimited.allowMcpServers,
    allowPackageManagers: inlineLimited.allowPackageManagers ?? baseLimited.allowPackageManagers,
  };
}
