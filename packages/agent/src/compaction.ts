/**
 * In-loop history compaction (B1.3).
 *
 * **Granularity:** v1 compacts at INTER-INVOCATION boundaries (between the
 * initial run and each grader revision). It does NOT compact mid-turn
 * inside a single `invokeAgent` call — pi-agent-core's `runAgentLoop` runs
 * to natural stop and doesn't expose per-turn hooks. Long single-shot
 * invocations that exceed contextWindow will still hit the hard limit.
 *
 * **Strategy:** when total estimated tokens >= `triggerRatio *
 * model.contextWindow`, summarize the middle segment (everything between
 * the pinned head and pinned tail) via a cheap model into a single
 * synthetic user message tagged `<compacted>`. Pre-compaction history is
 * persisted in `run_messages` so the dashboard / replay can show what was
 * dropped.
 *
 * **Pinned set** (defaults):
 *   - First `pinHead` messages (default 2: system + original user prompt)
 *   - Last `pinTail` turns (default 4)
 *
 * **Off by default.** Flip rule (per plan): lowest mean `$/success`
 * across all 4 datasets at no pass-rate regression. Enable via
 * `engine.compaction = { mode: "auto" }` once eval-green.
 *
 * Token estimation uses a 4-chars-per-token heuristic. Real BPE tokenizers
 * vary, but we don't need precision — we need a stable signal that crosses
 * the threshold consistently for the same conversation.
 */

import type { AgentMessage, StreamFn } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import type { Message } from "@mariozechner/pi-ai";

import type { CompactionConfig, MessageProvider } from "@oddjob/core";

import type { ResolvedLLM } from "./loop.ts";

const DEFAULT_TRIGGER_RATIO = 0.7;
const DEFAULT_PIN_HEAD = 2;
const DEFAULT_PIN_TAIL = 4;
const APPROX_CHARS_PER_TOKEN = 4;

const COMPACTION_SYSTEM_PROMPT = `You compress a conversation between a user, an AI assistant, and tool results.

Your output is a SINGLE PARAGRAPH summary. Capture:
  - The user's original goal
  - Key decisions, plans, and intermediate findings
  - Files / artifacts the assistant has created or modified (paths + brief contents)
  - Tool calls that produced results the assistant is actively using
  - Errors / dead ends to avoid

DO NOT:
  - Repeat the conversation verbatim
  - Include code blocks longer than 5 lines
  - Add commentary about the compression itself

The summary will REPLACE the conversation history; the assistant will continue from your summary. Be precise, dense, and factual.`;

/**
 * Estimate token count of a list of messages using a char-based heuristic.
 * Conservative — slight over-estimation is preferable to under-estimation
 * (hitting the real limit mid-stream is worse than compacting too early).
 */
export function estimateTokens(messages: AgentMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    const content = (msg as { content?: unknown }).content;
    if (typeof content === "string") {
      chars += content.length;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === "object" && block !== null) {
          const text = (block as { text?: string }).text;
          if (typeof text === "string") chars += text.length;
        }
      }
    }
  }
  return Math.ceil(chars / APPROX_CHARS_PER_TOKEN);
}

export interface CompactionDecision {
  shouldCompact: boolean;
  estimatedTokens: number;
  threshold: number;
  contextWindow: number;
}

export function planCompaction(
  messages: AgentMessage[],
  contextWindow: number,
  cfg: CompactionConfig | undefined,
): CompactionDecision {
  const ratio = cfg?.triggerRatio ?? DEFAULT_TRIGGER_RATIO;
  const threshold = Math.floor(contextWindow * ratio);
  const estimatedTokens = estimateTokens(messages);
  const enabled = (cfg?.mode ?? "off") === "auto";
  return {
    shouldCompact: enabled && estimatedTokens >= threshold,
    estimatedTokens,
    threshold,
    contextWindow,
  };
}

export interface CompactionResult {
  /** New message list to use as the agent's prior history. Length is `pinHead + 1 + pinTail` at most. */
  messages: AgentMessage[];
  /** Indices [start, end) in the ORIGINAL list that were collapsed into the summary. */
  collapsedRange: [number, number];
  /** The synthesized summary text (also embedded in messages). */
  summary: string;
  /** Tokens of the original collapsed segment, by estimate. */
  collapsedTokens: number;
  /** Tokens of the new compacted-segment message, by estimate. */
  compactedTokens: number;
  /** Real usage from the summarization call (tokens + cost). Undefined when streamFn skipped. */
  usage?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
    costUsd?: number;
  };
}

export interface CompactionContext {
  /** LLM used to produce the summary. Plan: a cheaper model than the run's primary. */
  llm: ResolvedLLM;
  /** Override stream fn for tests/replay/tracing. Same shape as pi-agent-core's StreamFn. */
  streamFn?: StreamFn;
  /** Abort signal. */
  signal?: AbortSignal;
}

/**
 * Compact a message history. Returns a NEW message list with the middle
 * collapsed into a single synthetic user message; original messages are
 * unchanged so the caller can persist them to `run_messages`.
 */
export async function compactHistory(
  messages: AgentMessage[],
  ctx: CompactionContext,
  cfg: CompactionConfig | undefined,
): Promise<CompactionResult> {
  const pinHead = cfg?.pinHead ?? DEFAULT_PIN_HEAD;
  const pinTail = cfg?.pinTail ?? DEFAULT_PIN_TAIL;
  const head = messages.slice(0, pinHead);
  const tail = pinTail > 0 ? messages.slice(-pinTail) : [];
  const middleStart = pinHead;
  const middleEnd = messages.length - pinTail;
  if (middleEnd <= middleStart) {
    // Nothing to compact — head + tail cover everything.
    return {
      messages: [...messages],
      collapsedRange: [middleStart, middleStart],
      summary: "",
      collapsedTokens: 0,
      compactedTokens: 0,
    };
  }
  const middle = messages.slice(middleStart, middleEnd);
  const collapsedTokens = estimateTokens(middle);

  const transcript = renderTranscript(middle);
  const { summary, usage } = await summarize(transcript, ctx);

  const compactedMsg: AgentMessage = {
    role: "user",
    content: `<compacted summary of ${middle.length} earlier messages>\n${summary}\n</compacted>`,
    timestamp: Date.now(),
  };
  const newMessages: AgentMessage[] = [...head, compactedMsg, ...tail];
  return {
    messages: newMessages,
    collapsedRange: [middleStart, middleEnd],
    summary,
    collapsedTokens,
    compactedTokens: estimateTokens([compactedMsg]),
    ...(usage ? { usage } : {}),
  };
}

function renderTranscript(messages: AgentMessage[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    const role = (msg as { role?: string }).role ?? "unknown";
    const content = (msg as { content?: unknown }).content;
    let text: string;
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .map((b) => {
          if (typeof b === "object" && b !== null) {
            const t = (b as { text?: string }).text;
            if (typeof t === "string") return t;
            const blockType = (b as { type?: string }).type ?? "block";
            return `[${blockType}]`;
          }
          return "";
        })
        .filter((s) => s.length > 0)
        .join("\n");
    } else {
      text = "";
    }
    parts.push(`### ${role}\n${text}`);
  }
  return parts.join("\n\n");
}

interface SummarizeResult {
  summary: string;
  usage?: CompactionResult["usage"];
}

async function summarize(transcript: string, ctx: CompactionContext): Promise<SummarizeResult> {
  const stream: StreamFn = ctx.streamFn ?? (streamSimple as StreamFn);
  const userMsg: Message = {
    role: "user",
    content: `Summarize this conversation:\n\n${transcript}`,
    timestamp: Date.now(),
  };
  const out = await stream(
    ctx.llm.model,
    {
      systemPrompt: COMPACTION_SYSTEM_PROMPT,
      messages: [userMsg],
    },
    {
      ...(ctx.llm.apiKey !== undefined ? { apiKey: ctx.llm.apiKey } : {}),
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
    },
  );
  let summary = "";
  let usage: SummarizeResult["usage"] | undefined;
  for await (const ev of out) {
    if (ev.type === "done") {
      const blocks = ev.message.content;
      for (const block of blocks) {
        if (block.type === "text") summary += block.text;
      }
      const u = ev.message.usage;
      if (u) {
        usage = {
          input: u.input ?? 0,
          output: u.output ?? 0,
          ...(u.cacheRead !== undefined ? { cacheRead: u.cacheRead } : {}),
          ...(u.cacheWrite !== undefined ? { cacheWrite: u.cacheWrite } : {}),
          ...(u.cost?.total !== undefined ? { costUsd: u.cost.total } : {}),
        };
      }
    } else if (ev.type === "error") {
      throw new Error(`compaction summarization failed: ${ev.error.errorMessage ?? "unknown"}`);
    }
  }
  return {
    summary: summary.trim() || "(empty summary)",
    ...(usage ? { usage } : {}),
  };
}

/**
 * Persist the collapsed segment of a compaction to a `MessageProvider`
 * before the in-memory transcript is replaced. Idempotent against an empty
 * range; tolerant of provider failures (caller should treat persistence as
 * best-effort observability, NOT durable replay state).
 *
 * Records the range as ordinary `user` / `assistant` / etc. rows, then
 * appends one final `compacted` row carrying the summary so dashboards can
 * render the boundary.
 */
export async function persistCollapsedSegment(
  runId: string,
  priorMessages: AgentMessage[],
  result: CompactionResult,
  provider: MessageProvider,
  onError?: (err: Error, seq: number) => void,
): Promise<{ recordedCount: number }> {
  const [start, end] = result.collapsedRange;
  if (end <= start) return { recordedCount: 0 };
  const collapsed = priorMessages.slice(start, end);
  if (collapsed.length === 0) return { recordedCount: 0 };
  let seq = await provider.nextSeq(runId).catch(() => 0);
  let recorded = 0;
  for (const m of collapsed) {
    const role =
      typeof (m as { role?: unknown }).role === "string"
        ? (m as { role: string }).role
        : "unknown";
    try {
      await provider.recordMessage({
        runId,
        seq,
        role,
        content: (m as { content?: unknown }).content ?? null,
        recordedAt: Date.now(),
      });
      recorded++;
    } catch (err) {
      onError?.(err as Error, seq);
    }
    seq++;
  }
  // Append the synthetic compacted summary as a final row so the boundary
  // is visible in run_messages without re-reading the live transcript.
  try {
    await provider.recordMessage({
      runId,
      seq,
      role: "compacted",
      content: result.summary,
      recordedAt: Date.now(),
    });
  } catch (err) {
    onError?.(err as Error, seq);
  }
  return { recordedCount: recorded };
}
