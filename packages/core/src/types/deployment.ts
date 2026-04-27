import type { BlueprintId } from "./blueprint.ts";
import type { ChannelConfig } from "./channel.ts";
import type { EnvironmentConfig, EnvironmentProviderRef } from "./environment.ts";
import type { Limits } from "./limits.ts";
import type { Trigger } from "./trigger.ts";

export type DeploymentId = string;

export type DeploymentStatus = "active" | "paused" | "disabled" | "archived";

export interface Deployment {
  id: DeploymentId;
  name: string;
  blueprintId: BlueprintId;
  /** Tag pointer the deployment follows (default "latest"). Resolved at dispatch. */
  blueprintTag: string;
  triggers: Trigger[];
  channels: ChannelConfig[];
  limits: Limits;
  status: DeploymentStatus;
  /** @deprecated since 0.0.x — use `modelRoleOverrides.default` instead. */
  modelOverride?: string;
  /**
   * Per-deployment role overrides keyed by ModelRole. JSON value is
   * `{ providerSlug, modelId, credentialName, options? }`.
   */
  modelRoleOverrides?: Record<string, ModelRoleOverride>;
  defaultInput?: unknown;
  /**
   * Reference to a stored Environment record by id. Resolved at dispatch
   * with `environmentInline` merged on top per the cascade resolver.
   */
  environmentId?: string;
  /**
   * Inline EnvironmentConfig override (or full inline config when
   * environmentId is unset). Merge semantics: values replace referenced
   * fields key-by-key; `networking.allowedHosts` is concat-merged.
   *
   * `provider` is loosened to a `Partial<EnvironmentProviderRef>` so a
   * deployment can override only the credential while inheriting the
   * service from the referenced environment.
   */
  environmentInline?: Omit<Partial<EnvironmentConfig>, "provider"> & {
    provider?: Partial<EnvironmentProviderRef>;
  };
  createdAt: number;
  updatedAt: number;
}

export interface ModelRoleOverride {
  providerSlug: string;
  modelId: string;
  credentialName?: string;
  options?: Record<string, unknown>;
}

export interface DeploymentInput {
  name: string;
  blueprintId: BlueprintId;
  blueprintTag?: string;
  triggers: Trigger[];
  channels: ChannelConfig[];
  limits?: Partial<Limits>;
  modelOverride?: string;
  modelRoleOverrides?: Record<string, ModelRoleOverride>;
  defaultInput?: unknown;
  environmentId?: string;
  environmentInline?: Omit<Partial<EnvironmentConfig>, "provider"> & {
    provider?: Partial<EnvironmentProviderRef>;
  };
}

export interface DeploymentListFilter {
  includeArchived?: boolean;
}
