import { completeSimple, type AssistantMessage, type Message } from "@mariozechner/pi-ai";

import type { LogEntry, LogProvider } from "@oddjob/core";
import type { Blueprint } from "@oddjob/core";
import type { ResolvedLLM } from "./loop.ts";

/**
 * Result returned by the grader sub-agent.
 *
 * - "satisfied": all rubric criteria met. Run is success.
 * - "needs_revision": at least one criterion missed. The harness will inject
 *   feedback as a synthetic user message and re-enter the agent loop.
 * - "failed": the rubric is structurally incompatible with the description
 *   (contradictory, ungradable, etc.) -- terminal verdict, no further loop.
 */
export type GraderResult = "satisfied" | "needs_revision" | "failed";

export interface GraderEvaluation {
  result: GraderResult;
  /** Human-readable summary of the grader's reasoning. */
  explanation: string;
  /** Per-criterion breakdown. Empty when result === "failed". */
  criteria?: Array<{ criterion: string; pass: boolean; reason?: string }>;
  /** Token usage for cost accounting. */
  usage?: { input: number; output: number; cost?: number };
}

export interface RunGraderOptions {
  blueprint: Blueprint;
  /** Resolved grader LLM. May share the agent's resolved LLM when no override. */
  llm: ResolvedLLM;
  /** Inline rubric body (markdown). */
  rubric: string;
  /** What the agent produced in this iteration (final assistant text + structured output). */
  artifact: string;
  /** Iteration index for logging (0 = first grading). */
  iteration: number;
  log?: LogProvider;
  runId: string;
  signal?: AbortSignal;
}

const SYSTEM_PROMPT = `You are an independent grader.

You are given:
- A description of the work that was requested.
- A rubric of criteria.
- An artifact: the actual output produced by another agent.

Score the artifact against EACH rubric criterion independently. You did not see the implementation, so judge ONLY what is in the artifact.

Respond with a single fenced JSON block. The schema is:

\`\`\`json
{
  "result": "satisfied" | "needs_revision" | "failed",
  "explanation": "short overall summary",
  "criteria": [
    { "criterion": "<the criterion text>", "pass": true|false, "reason": "<why>" }
  ]
}
\`\`\`

Use:
- "satisfied" when EVERY rubric criterion passes.
- "needs_revision" when at least one criterion fails AND the gap is fixable (give actionable feedback in the criterion 'reason' fields and the overall explanation).
- "failed" when the rubric is structurally incompatible with the work description (contradictory, ungradable). This is a terminal verdict.

Be terse. Do not praise. Do not speculate beyond the artifact.`;

const FENCE_PATTERN = /```(?:json)?\s*\n([\s\S]*?)\n```/;

export async function runGrader(opts: RunGraderOptions): Promise<GraderEvaluation> {
  const { blueprint, llm, rubric, artifact, iteration, log, runId, signal } = opts;
  const append = (entry: LogEntry) => {
    if (log) void log.log(runId, entry);
  };

  const userPrompt = [
    "## Work description",
    blueprint.outcomes?.success ?? blueprint.description,
    "",
    "## Rubric",
    rubric,
    "",
    "## Artifact",
    artifact,
  ].join("\n");

  append({
    timestamp: Date.now(),
    level: "info",
    message: `grader iteration ${iteration} starting`,
  });

  const messages: Message[] = [{ role: "user", content: userPrompt, timestamp: Date.now() }];
  let response: AssistantMessage;
  try {
    response = await completeSimple(
      llm.model,
      { systemPrompt: SYSTEM_PROMPT, messages },
      { apiKey: llm.apiKey, signal },
    );
  } catch (err) {
    append({
      timestamp: Date.now(),
      level: "error",
      message: `grader call failed: ${(err as Error).message}`,
    });
    return {
      result: "needs_revision",
      explanation: `grader unavailable: ${(err as Error).message}`,
    };
  }

  const text = extractText(response);
  const evaluation = parseEvaluation(text);

  append({
    timestamp: Date.now(),
    level: evaluation.result === "satisfied" ? "info" : "warn",
    message: `grader iteration ${iteration} -> ${evaluation.result}`,
    meta: { explanation: evaluation.explanation.slice(0, 200) },
  });

  if (response.usage) {
    evaluation.usage = {
      input: response.usage.input ?? 0,
      output: response.usage.output ?? 0,
      cost: response.usage.cost?.total,
    };
  }
  return evaluation;
}

function extractText(msg: AssistantMessage): string {
  const blocks = msg.content ?? [];
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("\n").trim();
}

function parseEvaluation(text: string): GraderEvaluation {
  const fence = FENCE_PATTERN.exec(text);
  const jsonSrc = fence ? fence[1] : text;
  if (!jsonSrc) {
    return { result: "needs_revision", explanation: "grader returned no JSON block" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSrc);
  } catch {
    return {
      result: "needs_revision",
      explanation: `grader response was not valid JSON: ${text.slice(0, 240)}`,
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return { result: "needs_revision", explanation: "grader JSON was not an object" };
  }
  const obj = parsed as Record<string, unknown>;
  const result =
    obj.result === "satisfied" || obj.result === "failed" ? obj.result : "needs_revision";
  const explanation = typeof obj.explanation === "string" ? obj.explanation : "(no explanation)";
  const criteria = Array.isArray(obj.criteria)
    ? obj.criteria
        .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
        .map((c) => ({
          criterion: typeof c.criterion === "string" ? c.criterion : "(unnamed)",
          pass: c.pass === true,
          reason: typeof c.reason === "string" ? c.reason : undefined,
        }))
    : undefined;
  return { result, explanation, criteria };
}

/**
 * Compose the synthetic user message that closes the loop: tell the agent
 * which criteria failed and ask it to revise.
 */
export function buildRevisionPrompt(evaluation: GraderEvaluation): string {
  const failed = evaluation.criteria?.filter((c) => !c.pass) ?? [];
  const lines: string[] = ["## Grader feedback", evaluation.explanation, ""];
  if (failed.length > 0) {
    lines.push("### Criteria still failing");
    for (const c of failed) {
      lines.push(`- **${c.criterion}** -- ${c.reason ?? "(no detail)"}`);
    }
  }
  lines.push(
    "",
    "Revise the artifact to satisfy these criteria, then re-run report_status if applicable.",
  );
  return lines.join("\n");
}
