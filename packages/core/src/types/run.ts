import type { BlueprintId } from "./blueprint.ts";
import type { DeploymentId } from "./deployment.ts";
import type { RunOutput } from "./output.ts";

export type RunId = string;

export type RunStatus = "queued" | "running" | "complete" | "failed" | "timeout" | "cancelled";

export type TriggeredBy = "cron" | "webhook" | "manual" | "event";

export interface Run {
  id: RunId;
  deploymentId: DeploymentId;
  blueprintId: BlueprintId;
  triggeredBy: TriggeredBy;
  status: RunStatus;
  input?: unknown;
  output?: RunOutput;
  error?: string;
  costUsd?: number;
  tokenInput: number;
  tokenOutput: number;
  toolCalls: number;
  startedAt?: number;
  finishedAt?: number;
  createdAt: number;
}

export interface RunConfig {
  deploymentId: DeploymentId;
  blueprintId: BlueprintId;
  triggeredBy: TriggeredBy;
  input?: unknown;
}
