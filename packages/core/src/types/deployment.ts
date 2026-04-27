import type { BlueprintId } from "./blueprint.ts";
import type { ChannelConfig } from "./channel.ts";
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
}

export interface DeploymentListFilter {
  includeArchived?: boolean;
}
