// Resolves a model role (default/advisor/grader/...) to a concrete pi-ai
// model + apiKey via the plugin registry, role assignments, and provider
// credentials. Order:
//   1. deployment role override
//   2. engine role assignment
//   3. legacy blueprint.model -> mapped to "default"
//   4. throw

import type { SecretsProvider } from "../providers/secrets.ts";
import type { Blueprint } from "../types/blueprint.ts";
import type {
  EngineModelRoleRecord,
  ModelInfo,
  ModelRole,
  ProviderCredential,
  ProviderCredentialRecord,
  ResolvedRoleModel,
} from "./types.ts";
import type { PluginRegistry } from "./registry.ts";

export interface RoleAssignment {
  providerSlug: string;
  modelId: string;
  credentialName: string;
  options?: Record<string, unknown>;
}

export interface RoleResolverOptions {
  registry: PluginRegistry;
  secrets?: SecretsProvider;
  /** Engine-wide role -> assignment map. Function so callers can hot-reload. */
  engineRoles: () => ReadonlyMap<string, EngineModelRoleRecord>;
  /** providerSlug -> credentialName -> record. Function so callers can hot-reload. */
  credentials: () => ReadonlyMap<string, ReadonlyMap<string, ProviderCredentialRecord>>;
  /** Optional fallback for legacy `blueprint.model` strings. */
  legacy?: LegacyResolver;
}

/**
 * Bridge for legacy `<provider>/<model>` strings (or
 * `openrouter/<vendor>/<model>`). When present and the role being resolved
 * is "default" with no engine assignment, the resolver falls back to this.
 */
export interface LegacyResolver {
  resolve(modelString: string, secretRef?: string): Promise<ResolvedRoleModel>;
}

export class RoleNotConfiguredError extends Error {
  constructor(public readonly role: string) {
    super(
      `no engine model assignment for role '${role}' (and no deployment override or legacy fallback)`,
    );
    this.name = "RoleNotConfiguredError";
  }
}

export class ProviderUnavailableError extends Error {
  constructor(public readonly providerSlug: string) {
    super(`provider plugin '${providerSlug}' is not registered or disabled`);
    this.name = "ProviderUnavailableError";
  }
}

export class ModelNotInCatalogError extends Error {
  constructor(
    public readonly providerSlug: string,
    public readonly modelId: string,
  ) {
    super(`provider '${providerSlug}' has no model '${modelId}' in its catalog`);
    this.name = "ModelNotInCatalogError";
  }
}

export class RoleResolver {
  constructor(private readonly opts: RoleResolverOptions) {}

  /**
   * Resolve a role for a specific blueprint + deployment context.
   * `deploymentOverrides` is the parsed `deployments.model_role_overrides_json`.
   * `legacyModel` is `blueprint.model` (already extracted by the caller).
   * `secretRef` is the secret name to use when falling back to legacy.
   */
  async resolve(
    role: ModelRole,
    deploymentOverrides: Record<string, RoleAssignment> | undefined,
    legacyModel?: string,
    secretRef?: string,
  ): Promise<ResolvedRoleModel> {
    const override = deploymentOverrides?.[role];
    if (override) return this.applyAssignment(override);

    const engineRow = this.opts.engineRoles().get(role);
    if (engineRow) {
      return this.applyAssignment({
        providerSlug: engineRow.providerSlug,
        modelId: engineRow.modelId,
        credentialName: engineRow.credentialName,
        options: parseOptions(engineRow.optionsJson),
      });
    }

    // Non-default roles fall back to "default" assignment if available.
    if (role !== "default") {
      const def = this.opts.engineRoles().get("default");
      if (def) {
        return this.applyAssignment({
          providerSlug: def.providerSlug,
          modelId: def.modelId,
          credentialName: def.credentialName,
          options: parseOptions(def.optionsJson),
        });
      }
    }

    // Legacy blueprint.model only for the default role.
    if (role === "default" && legacyModel && this.opts.legacy) {
      return this.opts.legacy.resolve(legacyModel, secretRef);
    }

    throw new RoleNotConfiguredError(role);
  }

  /** Resolve a deployment override + engine roles for a given blueprint. */
  static parseDeploymentOverrides(
    raw: string | undefined,
  ): Record<string, RoleAssignment> | undefined {
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as Record<string, RoleAssignment>;
      return parsed;
    } catch {
      return undefined;
    }
  }

  /**
   * Helper for blueprint validation: do all required roles have assignments?
   * Considers deployment overrides, engine roles, and (for "default") the
   * legacy blueprint.model path.
   */
  hasRole(
    role: ModelRole,
    deploymentOverrides: Record<string, RoleAssignment> | undefined,
    legacyModel?: string,
  ): boolean {
    if (deploymentOverrides?.[role]) return true;
    const roles = this.opts.engineRoles();
    if (roles.has(role)) return true;
    if (role !== "default" && roles.has("default")) return true;
    if (role === "default" && legacyModel) return true;
    return false;
  }

  /**
   * Resolve a default-role model for a blueprint with its full secrets/legacy
   * context. Convenience for the worker pool's most common path.
   */
  async resolveForBlueprint(
    role: ModelRole,
    blueprint: Pick<Blueprint, "model" | "secrets">,
    deploymentOverrides: Record<string, RoleAssignment> | undefined,
  ): Promise<ResolvedRoleModel> {
    const secretRef =
      blueprint.secrets?.openrouter ?? blueprint.secrets?.api ?? blueprint.secrets?.anthropic;
    return this.resolve(role, deploymentOverrides, blueprint.model, secretRef);
  }

  /** Optional model catalog metadata for a (provider, model) pair. */
  catalogEntry(providerSlug: string, modelId: string): ModelInfo | undefined {
    const provider = this.opts.registry.providerFor(providerSlug);
    if (!provider) return undefined;
    return provider.listModels().find((m) => m.id === modelId);
  }

  private async applyAssignment(a: RoleAssignment): Promise<ResolvedRoleModel> {
    const provider = this.opts.registry.providerFor(a.providerSlug);
    if (!provider) throw new ProviderUnavailableError(a.providerSlug);

    const credRow = this.opts.credentials().get(a.providerSlug)?.get(a.credentialName);
    const credential = await this.materializeCredential(credRow, a.options);

    const info = provider.listModels().find((m) => m.id === a.modelId);
    // Provider may accept arbitrary model ids (e.g. OpenRouter passthrough),
    // so don't throw if catalog entry missing — just skip the metadata.
    const resolved = provider.createClient(a.modelId, credential);
    return info ? { ...resolved, info } : resolved;
  }

  private async materializeCredential(
    row: ProviderCredentialRecord | undefined,
    extraOptions?: Record<string, unknown>,
  ): Promise<ProviderCredential> {
    let apiKey: string | undefined;
    if (row?.apiKeySecret && this.opts.secrets) {
      apiKey = (await this.opts.secrets.get(row.apiKeySecret)) ?? undefined;
    }
    let options: Record<string, unknown> | undefined;
    if (row?.optionsJson) {
      try {
        options = JSON.parse(row.optionsJson) as Record<string, unknown>;
      } catch {
        options = undefined;
      }
    }
    if (extraOptions) options = { ...options, ...extraOptions };
    // Accept either camelCase (JS) or snake_case (TOML) baseUrl on credentials.
    const baseUrl =
      typeof options?.baseUrl === "string"
        ? (options.baseUrl as string)
        : typeof (options as Record<string, unknown> | undefined)?.base_url === "string"
          ? ((options as Record<string, unknown>).base_url as string)
          : undefined;
    if (baseUrl && options) {
      options = { ...options, baseUrl };
    }
    return { apiKey, baseUrl, options };
  }
}

function parseOptions(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
