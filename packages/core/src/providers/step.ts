import type { Provider } from "./base.ts";

export type StepKind =
  | "llm_call"
  | "tool_call"
  | "grader"
  | "verdict"
  | "compaction"
  | "classifier"
  | "subagent";

export interface StepRecord {
  stepId: string;
  runId: string;
  parentStepId?: string;
  iteration: number;
  kind: StepKind;
  startedAt: number;
  endedAt?: number;
  tokensIn?: number;
  tokensOut?: number;
  cacheRead?: number;
  cacheWrite?: number;
  costUsd?: number;
  model?: string;
  toolName?: string;
  toolArgsHash?: string;
  toolResultSize?: number;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface StepQuery {
  kind?: StepKind;
  since?: number;
  limit?: number;
}

export interface StepProvider extends Provider {
  recordStep(step: StepRecord): Promise<void>;
  getSteps(runId: string, options?: StepQuery): Promise<StepRecord[]>;
}
