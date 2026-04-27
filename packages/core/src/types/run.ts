import type { BlueprintId } from "./blueprint.ts";
import type { DeploymentId } from "./deployment.ts";
import type { RunOutput } from "./output.ts";

export type RunId = string;

export type RunStatus =
  | "queued"
  | "running"
  | "complete"
  | "failed"
  | "retrying"
  | "timeout"
  | "cancelled"
  | "awaiting_confirmation";

export type TriggeredBy = "cron" | "webhook" | "manual" | "event";

export interface Run {
  id: RunId;
  deploymentId: DeploymentId;
  blueprintId: BlueprintId;
  /** Resolved blueprint version that this run executed (snapshot at dispatch). */
  blueprintVersion?: string;
  /** sha256 of the blueprint TOML at dispatch (provenance, distinct from version label). */
  blueprintHash?: string;
  triggeredBy: TriggeredBy;
  status: RunStatus;
  input?: unknown;
  output?: RunOutput;
  outputValidation?: OutputValidation;
  error?: string;
  costUsd?: number;
  tokenInput: number;
  tokenOutput: number;
  toolCalls: number;
  startedAt?: number;
  finishedAt?: number;
  createdAt: number;
  /**
   * Snapshot of the resolved Environment at dispatch. Persists provenance so
   * historical runs survive later edits to environment records / engine
   * defaults. `id` is the source Environment row (when ref- or default-
   * resolved); `source` records which cascade path won.
   */
  environmentSnapshot?: RunEnvironmentSnapshot;
}

export interface RunEnvironmentSnapshot {
  /** Source Environment record id, if the resolution went through one. */
  id?: string;
  /** Which cascade path won. */
  source: "inline" | "deployment-ref" | "engine-default" | "hard-default";
  /** EnvironmentService.id ("process" / "seatbelt" / "docker" / "daytona" / ...). */
  serviceId: string;
  /** Trust posture surfaced by the dashboard. */
  trustTier: "trusted" | "local-strict" | "container" | "remote-vm";
}

export interface OutputValidation {
  ok: boolean;
  errors?: OutputValidationError[];
  /** "json-schema" | "skipped" (no schema declared) | "no-output" */
  source: "json-schema" | "skipped" | "no-output";
}

export interface OutputValidationError {
  path: string;
  message: string;
}

export interface RunConfig {
  deploymentId: DeploymentId;
  blueprintId: BlueprintId;
  triggeredBy: TriggeredBy;
  input?: unknown;
}
