import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  fauxAssistantMessage,
  fauxText,
  registerFauxProvider,
  type Model,
} from "@mariozechner/pi-ai";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

import type { MessageProvider, MessageQuery, MessageRecord } from "@oddjob/core";

import {
  compactHistory,
  estimateTokens,
  persistCollapsedSegment,
  planCompaction,
  type CompactionResult,
} from "./compaction.ts";

class CapturingMessageProvider implements MessageProvider {
  readonly name = "capturing-msg";
  readonly records: MessageRecord[] = [];
  failNext = 0;

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthy(): Promise<boolean> {
    return true;
  }
  async recordMessage(record: MessageRecord): Promise<void> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("simulated provider write failure");
    }
    this.records.push(record);
  }
  async getMessages(runId: string, _opts?: MessageQuery): Promise<MessageRecord[]> {
    return this.records.filter((r) => r.runId === runId);
  }
  async nextSeq(runId: string): Promise<number> {
    const rs = this.records.filter((r) => r.runId === runId).map((r) => r.seq);
    return rs.length === 0 ? 0 : Math.max(...rs) + 1;
  }
}

describe("estimateTokens", () => {
  test("0 messages → 0", () => {
    expect(estimateTokens([])).toBe(0);
  });

  test("string content sums chars/4", () => {
    const m: AgentMessage = { role: "user", content: "X".repeat(40), timestamp: 0 };
    expect(estimateTokens([m])).toBe(10);
  });

  test("multi-block content sums text fields", () => {
    const m: AgentMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "hello world" }, // 11 chars
        { type: "text", text: "foo" }, // 3 chars
        { type: "image", source: { type: "url", url: "https://x" } } as never,
      ],
      timestamp: 0,
    } as never;
    expect(estimateTokens([m])).toBe(Math.ceil(14 / 4));
  });
});

describe("planCompaction", () => {
  test("disabled when mode=off (default)", () => {
    const msgs: AgentMessage[] = Array.from({ length: 50 }, (_, i) => ({
      role: "user",
      content: "X".repeat(2000),
      timestamp: i,
    }));
    const p = planCompaction(msgs, 8000, undefined);
    expect(p.shouldCompact).toBe(false);
  });

  test("triggers when mode=auto and tokens exceed threshold", () => {
    const msgs: AgentMessage[] = Array.from({ length: 30 }, (_, i) => ({
      role: "user",
      content: "X".repeat(1000),
      timestamp: i,
    }));
    const p = planCompaction(msgs, 10000, { mode: "auto", triggerRatio: 0.5 });
    expect(p.estimatedTokens).toBe(7500); // 30000 chars / 4 = 7500
    expect(p.threshold).toBe(5000);
    expect(p.shouldCompact).toBe(true);
  });

  test("respects custom triggerRatio", () => {
    const msgs: AgentMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: "user",
      content: "X".repeat(400),
      timestamp: i,
    }));
    const p = planCompaction(msgs, 1000, { mode: "auto", triggerRatio: 0.9 });
    // 4000 chars / 4 = 1000 tokens; threshold 0.9 * 1000 = 900
    expect(p.shouldCompact).toBe(true);
  });
});

describe("compactHistory", () => {
  let model: Model<"openai-completions">;
  let registry: ReturnType<typeof registerFauxProvider>;

  beforeEach(() => {
    registry = registerFauxProvider({ models: [{ id: "compact-test" }] });
    model = registry.getModel() as Model<"openai-completions">;
  });

  afterEach(() => {
    registry.unregister();
  });

  test("returns input unchanged when nothing to compact (head+tail covers all)", async () => {
    const msgs: AgentMessage[] = [
      { role: "user", content: "hello", timestamp: 0 },
      {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        timestamp: 1,
      } as unknown as AgentMessage,
      { role: "user", content: "ok", timestamp: 2 },
    ];
    const r = await compactHistory(msgs, { llm: { model } }, { pinHead: 2, pinTail: 4 });
    expect(r.messages).toHaveLength(3);
    expect(r.collapsedRange).toEqual([2, 2]);
    expect(r.summary).toBe("");
  });

  test("collapses middle segment into a synthetic user message", async () => {
    registry.setResponses([
      fauxAssistantMessage([fauxText("Brief summary of the middle.")], { stopReason: "stop" }),
    ]);
    // Assistant messages need array content; users can use string. Cast per
    // role to the AgentMessage union.
    const u = (text: string, ts: number): AgentMessage =>
      ({ role: "user", content: text, timestamp: ts } as AgentMessage);
    const a = (text: string, ts: number): AgentMessage =>
      ({
        role: "assistant",
        content: [{ type: "text", text }],
        timestamp: ts,
      } as unknown as AgentMessage);
    const msgs: AgentMessage[] = [
      u("first prompt", 0),
      a("first reply", 1),
      u("middle 1", 2),
      a("middle 2", 3),
      u("middle 3", 4),
      a("middle 4", 5),
      u("tail 1", 6),
      a("tail 2", 7),
      u("tail 3", 8),
      a("tail 4", 9),
    ];
    const r = await compactHistory(msgs, { llm: { model } }, { pinHead: 2, pinTail: 4 });
    // Expect 2 head + 1 compacted + 4 tail = 7 messages
    expect(r.messages).toHaveLength(7);
    const grab = (m: unknown): string => {
      const c = (m as { content?: unknown }).content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) {
        const first = c[0] as { text?: string } | undefined;
        return first?.text ?? "";
      }
      return "";
    };
    expect(grab(r.messages[0])).toBe("first prompt");
    expect(grab(r.messages[1])).toBe("first reply");
    expect(grab(r.messages[2]).startsWith("<compacted summary of 4 earlier messages")).toBe(true);
    expect(grab(r.messages[2])).toContain("Brief summary of the middle.");
    expect(grab(r.messages[6])).toBe("tail 4");
    expect(r.collapsedRange).toEqual([2, 6]);
    expect(r.collapsedTokens).toBeGreaterThan(0);
    expect(r.summary).toContain("Brief summary");
  });

  test("compaction error throws with descriptive message", async () => {
    // Faux provider with no responses queued — streamSimple errors out
    registry.setResponses([]);
    const msgs: AgentMessage[] = [];
    for (let i = 0; i < 10; i++) {
      // user-only messages — keep the type narrow so the AgentMessage union resolves
      msgs.push({ role: "user", content: `msg ${i}`, timestamp: i });
    }
    await expect(() =>
      compactHistory(msgs, { llm: { model } }, { pinHead: 2, pinTail: 4 }),
    ).toThrow();
  });
});

describe("persistCollapsedSegment", () => {
  // Build a synthetic CompactionResult so we don't have to drive the LLM.
  function makeResult(
    collapsed: AgentMessage[],
    range: [number, number],
    summary: string,
  ): CompactionResult {
    const compactedMsg: AgentMessage = {
      role: "user",
      content: `<compacted summary>${summary}</compacted>`,
      timestamp: Date.now(),
    };
    return {
      messages: [compactedMsg],
      collapsedRange: range,
      summary,
      collapsedTokens: estimateTokens(collapsed),
      compactedTokens: estimateTokens([compactedMsg]),
    };
  }

  test("writes each collapsed message + a final 'compacted' summary row", async () => {
    const prior: AgentMessage[] = [
      { role: "user", content: "kept-head-0", timestamp: 0 },
      { role: "user", content: "kept-head-1", timestamp: 1 },
      { role: "user", content: "collapsed-A", timestamp: 2 },
      { role: "user", content: "collapsed-B", timestamp: 3 },
      { role: "user", content: "collapsed-C", timestamp: 4 },
      { role: "user", content: "kept-tail-0", timestamp: 5 },
      { role: "user", content: "kept-tail-1", timestamp: 6 },
    ];
    const result = makeResult(prior.slice(2, 5), [2, 5], "Brief summary.");
    const provider = new CapturingMessageProvider();
    const r = await persistCollapsedSegment("run-1", prior, result, provider);
    expect(r.recordedCount).toBe(3);
    const records = await provider.getMessages("run-1");
    // 3 originals + 1 'compacted' summary row = 4
    expect(records).toHaveLength(4);
    expect(records.map((m) => m.role)).toEqual(["user", "user", "user", "compacted"]);
    expect(records[0]?.content).toBe("collapsed-A");
    expect(records[1]?.content).toBe("collapsed-B");
    expect(records[2]?.content).toBe("collapsed-C");
    expect(records[3]?.content).toBe("Brief summary.");
    expect(records.map((m) => m.seq)).toEqual([0, 1, 2, 3]);
  });

  test("no-op when collapsedRange is empty", async () => {
    const provider = new CapturingMessageProvider();
    const r = await persistCollapsedSegment(
      "run-1",
      [{ role: "user", content: "x", timestamp: 0 }],
      makeResult([], [0, 0], ""),
      provider,
    );
    expect(r.recordedCount).toBe(0);
    expect(provider.records).toHaveLength(0);
  });

  test("appends after existing seq (nextSeq honored)", async () => {
    const provider = new CapturingMessageProvider();
    // Pre-existing record at seq 5
    await provider.recordMessage({
      runId: "run-2",
      seq: 5,
      role: "user",
      content: "earlier",
      recordedAt: 100,
    });
    const prior: AgentMessage[] = [
      { role: "user", content: "h", timestamp: 0 },
      { role: "user", content: "h", timestamp: 1 },
      { role: "user", content: "mid", timestamp: 2 },
      { role: "user", content: "t", timestamp: 3 },
      { role: "user", content: "t", timestamp: 4 },
    ];
    const result = makeResult(prior.slice(2, 3), [2, 3], "x");
    await persistCollapsedSegment("run-2", prior, result, provider);
    const records = await provider.getMessages("run-2");
    // 1 pre-existing + 1 collapsed + 1 compacted summary
    expect(records).toHaveLength(3);
    expect(records.map((m) => m.seq)).toEqual([5, 6, 7]);
  });

  test("provider failures are reported via onError but do not throw", async () => {
    const provider = new CapturingMessageProvider();
    provider.failNext = 1; // first recordMessage fails
    const prior: AgentMessage[] = [
      { role: "user", content: "h", timestamp: 0 },
      { role: "user", content: "h", timestamp: 1 },
      { role: "user", content: "collapsed", timestamp: 2 },
      { role: "user", content: "t", timestamp: 3 },
      { role: "user", content: "t", timestamp: 4 },
    ];
    const result = makeResult(prior.slice(2, 3), [2, 3], "summary");
    const errors: Array<{ msg: string; seq: number }> = [];
    const r = await persistCollapsedSegment("run-3", prior, result, provider, (err, seq) => {
      errors.push({ msg: err.message, seq });
    });
    // First write failed; the compacted-summary row still landed
    expect(r.recordedCount).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.seq).toBe(0);
    const records = await provider.getMessages("run-3");
    expect(records.map((m) => m.role)).toEqual(["compacted"]);
  });
});
