export interface Limits {
  durationMs?: number;
  toolCalls?: number;
  budgetUsd?: number;
  warnThresholdPct: number;
}

export const DEFAULT_LIMITS: Limits = {
  durationMs: 5 * 60 * 1000,
  toolCalls: 50,
  budgetUsd: 0.5,
  warnThresholdPct: 80,
};
