import * as React from "react";

import type { StepKind, StepRecord } from "@oddjob/core";

import { useRunSteps } from "../../api/queries.ts";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";
import { cn } from "../../lib/utils.ts";

const KIND_COLOR: Record<StepKind, string> = {
  llm_call: "bg-blue-500",
  tool_call: "bg-emerald-500",
  grader: "bg-purple-500",
  verdict: "bg-slate-500",
  compaction: "bg-amber-500",
  classifier: "bg-pink-500",
  subagent: "bg-teal-500",
};

const KIND_LABEL: Record<StepKind, string> = {
  llm_call: "LLM",
  tool_call: "Tool",
  grader: "Grader",
  verdict: "Verdict",
  compaction: "Compact",
  classifier: "Classify",
  subagent: "Subagent",
};

const MIN_BAR_PX = 2;

export interface RunWaterfallProps {
  runId: string;
  live: boolean;
  /** Wall-clock anchor for the x axis. Defaults to the earliest startedAt. */
  startedAt?: number;
}

export function RunWaterfall({ runId, live, startedAt }: RunWaterfallProps): React.JSX.Element {
  const q = useRunSteps(runId, live);
  const steps = q.data?.steps ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step waterfall</CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading && steps.length === 0 ? (
          <div className="text-sm text-(--text-muted)">Loading steps…</div>
        ) : steps.length === 0 ? (
          <div className="text-sm text-(--text-muted)">No step trace recorded.</div>
        ) : (
          <Waterfall steps={steps} startedAt={startedAt} />
        )}
      </CardContent>
    </Card>
  );
}

function Waterfall({
  steps,
  startedAt,
}: {
  steps: StepRecord[];
  startedAt?: number;
}): React.JSX.Element {
  // x-axis bounds: anchor at run.startedAt (or the earliest step) → max endedAt
  // (or now for any still-open row).
  const earliest = startedAt ?? steps.reduce((m, s) => Math.min(m, s.startedAt), Infinity);
  const now = Date.now();
  const latest = steps.reduce((m, s) => Math.max(m, s.endedAt ?? now), earliest + 1);
  const totalMs = Math.max(latest - earliest, 1);

  // Sort by start order; stable for equal timestamps via secondary stepId compare.
  const ordered = [...steps].toSorted((a, b) =>
    a.startedAt === b.startedAt ? a.stepId.localeCompare(b.stepId) : a.startedAt - b.startedAt,
  );

  return (
    <div className="space-y-1.5">
      <Axis totalMs={totalMs} />
      <ul className="space-y-1" data-testid="run-waterfall-rows">
        {ordered.map((s) => (
          <Row key={s.stepId} step={s} earliest={earliest} totalMs={totalMs} />
        ))}
      </ul>
    </div>
  );
}

function Axis({ totalMs }: { totalMs: number }): React.JSX.Element {
  return (
    <div className="flex justify-between text-[10px] text-(--text-muted) font-mono">
      <span>0ms</span>
      <span>{formatMs(totalMs)}</span>
    </div>
  );
}

function Row({
  step,
  earliest,
  totalMs,
}: {
  step: StepRecord;
  earliest: number;
  totalMs: number;
}): React.JSX.Element {
  const start = Math.max(0, step.startedAt - earliest);
  const end = (step.endedAt ?? step.startedAt) - earliest;
  const durMs = Math.max(end - start, 0);
  const leftPct = (start / totalMs) * 100;
  const widthPct = (durMs / totalMs) * 100;
  const tooltip = buildTooltip(step);
  const label = `${KIND_LABEL[step.kind] ?? step.kind}${step.toolName ? `: ${step.toolName}` : ""}`;

  return (
    <li className="grid grid-cols-[120px_1fr] items-center gap-3" title={tooltip}>
      <div className="truncate text-xs font-mono text-(--text-muted)">{label}</div>
      <div className="relative h-4 rounded bg-(--surface-2)">
        <div
          className={cn(
            "absolute top-0 h-full rounded",
            KIND_COLOR[step.kind] ?? "bg-gray-400",
            step.error && "ring-1 ring-red-500",
          )}
          style={{
            left: `${leftPct}%`,
            width: `max(${MIN_BAR_PX}px, ${widthPct}%)`,
          }}
          aria-label={tooltip}
        />
      </div>
    </li>
  );
}

function buildTooltip(s: StepRecord): string {
  const lines: string[] = [];
  lines.push(`${KIND_LABEL[s.kind] ?? s.kind} · iter=${s.iteration}`);
  if (s.endedAt) lines.push(`duration: ${formatMs(s.endedAt - s.startedAt)}`);
  if (s.toolName) lines.push(`tool: ${s.toolName}`);
  if (s.toolArgsHash) lines.push(`args: ${s.toolArgsHash.slice(0, 8)}`);
  if (s.toolResultSize != null) lines.push(`result: ${s.toolResultSize}B`);
  if (s.tokensIn != null || s.tokensOut != null) {
    lines.push(`tokens in/out: ${s.tokensIn ?? 0} / ${s.tokensOut ?? 0}`);
  }
  if (s.cacheRead != null || s.cacheWrite != null) {
    lines.push(`cache r/w: ${s.cacheRead ?? 0} / ${s.cacheWrite ?? 0}`);
  }
  if (s.costUsd != null) lines.push(`cost: $${s.costUsd.toFixed(6)}`);
  if (s.model) lines.push(`model: ${s.model}`);
  if (s.error) lines.push(`error: ${s.error}`);
  return lines.join("\n");
}

function formatMs(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
