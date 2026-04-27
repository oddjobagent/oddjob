import type { Static } from "typebox";
import { Type } from "typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

export type RunOutcome = "success" | "warning" | "error";

export interface RunVerdict {
  outcome: RunOutcome;
  reason: string;
}

const schema = Type.Object({
  outcome: Type.Union(
    [Type.Literal("success"), Type.Literal("warning"), Type.Literal("error")],
    {
      description:
        "success = goal achieved | warning = transient/retryable failure | error = fatal, retry will not help",
    },
  ),
  reason: Type.String({
    description: "One-sentence explanation. For warning/error, identify what failed and where.",
  }),
});
type Input = Static<typeof schema>;

export interface ReportStatusToolOptions {
  onVerdict: (v: RunVerdict) => void;
}

export function createReportStatusTool(opts: ReportStatusToolOptions): AgentTool<typeof schema> {
  return {
    name: "report_status",
    label: "Report Status",
    description:
      "Record the run's authoritative outcome. Call exactly once before terminating. Use 'success' when the Blueprint goal was achieved, 'warning' for retryable failures, 'error' for fatal failures (no retry).",
    parameters: schema,
    async execute(_id, params: Input) {
      opts.onVerdict({ outcome: params.outcome, reason: params.reason });
      return {
        content: [{ type: "text", text: `verdict recorded: ${params.outcome}` }],
        details: { outcome: params.outcome, reason: params.reason },
      };
    },
  };
}
