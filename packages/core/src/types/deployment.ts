import type { BlueprintId } from "./blueprint.ts";
import type { ChannelConfig } from "./channel.ts";
import type { Limits } from "./limits.ts";
import type { Trigger } from "./trigger.ts";

export type DeploymentId = string;

export type DeploymentStatus = "active" | "paused" | "disabled";

export interface Deployment {
  id: DeploymentId;
  name: string;
  blueprintId: BlueprintId;
  triggers: Trigger[];
  channels: ChannelConfig[];
  limits: Limits;
  status: DeploymentStatus;
  createdAt: number;
  updatedAt: number;
}

export interface DeploymentInput {
  name: string;
  blueprintId: BlueprintId;
  triggers: Trigger[];
  channels: ChannelConfig[];
  limits?: Partial<Limits>;
}
