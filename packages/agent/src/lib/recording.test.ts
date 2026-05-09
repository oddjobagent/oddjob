import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  type AssistantMessage,
  type AssistantMessageEvent,
  createAssistantMessageEventStream,
  type Model,
  type Usage,
} from "@mariozechner/pi-ai";
import type { StreamFn } from "@mariozechner/pi-agent-core";

import { maybeRecordingFromEnv, recordingWrapper, replayFromJsonl } from "./recording.ts";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const usage: Usage = {
  input: 10,
  output: 20,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 30,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function makeModel(id: string): Model<"openai-completions"> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: "openai",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 1024,
  };
}

function makeFinalMessage(model: Model<"openai-completions">): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "hello" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason: "stop",
    usage,
    timestamp: 1_700_000_000_000,
  };
}

/** A faux StreamFn that emits a fixed `start` -> `text_delta` -> `done` sequence. */
function fauxStream(text: string): StreamFn {
  return (model) => {
    const stream = createAssistantMessageEventStream();
    const partial: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "" }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      stopReason: "stop",
      usage,
      timestamp: 1_700_000_000_000,
    };
    queueMicrotask(() => {
      const start: AssistantMessageEvent = { type: "start", partial };
      stream.push(start);
      const partialWithText: AssistantMessage = {
        ...partial,
        content: [{ type: "text", text }],
      };
      stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: partialWithText });
      stream.push({
        type: "done",
        reason: "stop",
        message: { ...partialWithText },
      });
      stream.end();
    });
    return stream;
  };
}

async function drain(
  stream: AsyncIterable<AssistantMessageEvent> | Promise<AsyncIterable<AssistantMessageEvent>>,
): Promise<AssistantMessageEvent[]> {
  const resolved = await stream;
  const out: AssistantMessageEvent[] = [];
  for await (const ev of resolved) out.push(ev);
  return out;
}

// ---------------------------------------------------------------------------
// tmp dir scaffolding
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-recording-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("recordingWrapper", () => {
  test("records a JSONL line per call and forwards events", async () => {
    const path = join(dir, "fixture.jsonl");
    const wrapped = recordingWrapper(fauxStream("hello"), path);

    const model = makeModel("gpt-4o-mini");
    const stream = wrapped(model, { messages: [], tools: [] }, undefined);
    const events = await drain(stream);

    expect(events.map((e) => e.type)).toEqual(["start", "text_delta", "done"]);

    const raw = await readFile(path, "utf8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.request.modelId).toBe("gpt-4o-mini");
    expect(parsed.events).toHaveLength(3);
    expect(parsed.usage.totalTokens).toBe(30);
  });

  test("records two calls to the same file", async () => {
    const path = join(dir, "two.jsonl");
    const wrapped = recordingWrapper(fauxStream("a"), path);
    const model = makeModel("gpt-4o-mini");

    await drain(wrapped(model, { messages: [], tools: [] }, undefined));
    await drain(wrapped(model, { messages: [], tools: [] }, undefined));

    const raw = await readFile(path, "utf8");
    expect(raw.split("\n").filter((l) => l.length > 0)).toHaveLength(2);
  });
});

describe("replayFromJsonl", () => {
  test("round-trips record -> replay", async () => {
    const path = join(dir, "rt.jsonl");
    const recorder = recordingWrapper(fauxStream("hello"), path);
    const model = makeModel("gpt-4o-mini");

    await drain(recorder(model, { messages: [], tools: [] }, undefined));

    const replay = replayFromJsonl(path);
    const events = await drain(replay(model, { messages: [], tools: [] }, undefined));

    expect(events.map((e) => e.type)).toEqual(["start", "text_delta", "done"]);
    const last = events.at(-1)!;
    expect(last.type).toBe("done");
    if (last.type === "done") {
      expect(last.message.model).toBe("gpt-4o-mini");
    }
  });

  test("emits a descriptive error event on model-name mismatch", async () => {
    const path = join(dir, "mm.jsonl");
    const recorder = recordingWrapper(fauxStream("hi"), path);

    await drain(recorder(makeModel("gpt-4o-mini"), { messages: [], tools: [] }, undefined));

    const replay = replayFromJsonl(path);
    const events = await drain(
      replay(makeModel("gpt-3.5"), { messages: [], tools: [] }, undefined),
    );

    const last = events.at(-1);
    expect(last?.type).toBe("error");
    if (last?.type === "error") {
      expect(last.error.errorMessage).toContain("modelId");
      expect(last.error.errorMessage).toContain("gpt-4o-mini");
      expect(last.error.errorMessage).toContain("gpt-3.5");
      expect(last.error.stopReason).toBe("error");
    }
  });

  test("emits a descriptive error event on tool-name mismatch", async () => {
    const path = join(dir, "tools.jsonl");
    const recorder = recordingWrapper(fauxStream("hi"), path);
    const model = makeModel("gpt-4o-mini");

    await drain(
      recorder(
        model,
        {
          messages: [],
          tools: [{ name: "bash", description: "", parameters: { type: "object" } as never }],
        },
        undefined,
      ),
    );

    const replay = replayFromJsonl(path);
    const events = await drain(
      replay(
        model,
        {
          messages: [],
          tools: [{ name: "read", description: "", parameters: { type: "object" } as never }],
        },
        undefined,
      ),
    );
    const last = events.at(-1);
    expect(last?.type).toBe("error");
    if (last?.type === "error") {
      expect(last.error.errorMessage).toContain("toolNames");
    }
  });

  test("rejects replay when systemPrompt drifts (message count + tool names match)", async () => {
    const path = join(dir, "syschange.jsonl");
    const recorder = recordingWrapper(fauxStream("hi"), path);
    const model = makeModel("gpt-4o-mini");

    await drain(
      recorder(
        model,
        {
          systemPrompt: "You are alice.",
          messages: [{ role: "user", content: "hi", timestamp: 0 }],
          tools: [],
        },
        undefined,
      ),
    );

    const replay = replayFromJsonl(path);
    const events = await drain(
      replay(
        model,
        {
          systemPrompt: "You are bob.", // changed
          messages: [{ role: "user", content: "hi", timestamp: 0 }],
          tools: [],
        },
        undefined,
      ),
    );
    const last = events.at(-1);
    expect(last?.type).toBe("error");
    if (last?.type === "error") {
      expect(last.error.errorMessage).toContain("requestHash");
      expect(last.error.errorMessage).toContain("systemPrompt");
    }
  });

  test("rejects replay when message content drifts (count + roles match)", async () => {
    const path = join(dir, "msgcontent.jsonl");
    const recorder = recordingWrapper(fauxStream("hi"), path);
    const model = makeModel("gpt-4o-mini");

    await drain(
      recorder(
        model,
        { messages: [{ role: "user", content: "first ask", timestamp: 0 }], tools: [] },
        undefined,
      ),
    );

    const replay = replayFromJsonl(path);
    const events = await drain(
      replay(
        model,
        { messages: [{ role: "user", content: "totally different ask", timestamp: 0 }], tools: [] },
        undefined,
      ),
    );
    const last = events.at(-1);
    expect(last?.type).toBe("error");
    if (last?.type === "error") {
      expect(last.error.errorMessage).toContain("requestHash");
      expect(last.error.errorMessage).toContain("messages or tool parameters");
    }
  });

  test("rejects replay when tool parameters change (same name)", async () => {
    const path = join(dir, "toolparam.jsonl");
    const recorder = recordingWrapper(fauxStream("hi"), path);
    const model = makeModel("gpt-4o-mini");

    await drain(
      recorder(
        model,
        {
          messages: [],
          tools: [
            {
              name: "do_thing",
              description: "",
              parameters: { type: "object", properties: { v1: { type: "string" } } } as never,
            },
          ],
        },
        undefined,
      ),
    );

    const replay = replayFromJsonl(path);
    const events = await drain(
      replay(
        model,
        {
          messages: [],
          tools: [
            {
              name: "do_thing", // SAME name
              description: "",
              parameters: { type: "object", properties: { v2: { type: "number" } } } as never, // different shape
            },
          ],
        },
        undefined,
      ),
    );
    const last = events.at(-1);
    expect(last?.type).toBe("error");
    if (last?.type === "error") {
      expect(last.error.errorMessage).toContain("requestHash");
    }
  });

  test("emits a descriptive error event on message-count mismatch", async () => {
    const path = join(dir, "msgcount.jsonl");
    const recorder = recordingWrapper(fauxStream("hi"), path);
    const model = makeModel("gpt-4o-mini");

    await drain(
      recorder(
        model,
        { messages: [{ role: "user", content: "hi", timestamp: 0 }], tools: [] },
        undefined,
      ),
    );

    const replay = replayFromJsonl(path);
    const events = await drain(replay(model, { messages: [], tools: [] }, undefined));
    const last = events.at(-1);
    expect(last?.type).toBe("error");
    if (last?.type === "error") {
      expect(last.error.errorMessage).toContain("messageCount");
    }
  });

  test("errors when more calls happen than recorded", async () => {
    const path = join(dir, "short.jsonl");
    const recorder = recordingWrapper(fauxStream("hi"), path);
    const model = makeModel("gpt-4o-mini");
    await drain(recorder(model, { messages: [], tools: [] }, undefined));

    const replay = replayFromJsonl(path);
    await drain(replay(model, { messages: [], tools: [] }, undefined)); // ok

    const events = await drain(replay(model, { messages: [], tools: [] }, undefined));
    const last = events.at(-1);
    expect(last?.type).toBe("error");
    if (last?.type === "error") {
      expect(last.error.errorMessage).toMatch(/ran out of recorded calls/);
    }
  });

  test("makeFinalMessage helper builds a sensible terminal", () => {
    // Anchor the helper so unused-export doesn't trip linters.
    const model = makeModel("gpt-4o-mini");
    const m = makeFinalMessage(model);
    expect(m.stopReason).toBe("stop");
  });
});

describe("maybeRecordingFromEnv", () => {
  test("passes through when env var unset", async () => {
    delete process.env.ODDJOB_RECORD_FIXTURE;
    const inner = fauxStream("x");
    const wrapped = maybeRecordingFromEnv(inner);
    expect(wrapped).toBe(inner);
  });

  test("passes through when env var is empty string", async () => {
    process.env.ODDJOB_RECORD_FIXTURE = "   ";
    try {
      const inner = fauxStream("x");
      expect(maybeRecordingFromEnv(inner)).toBe(inner);
    } finally {
      delete process.env.ODDJOB_RECORD_FIXTURE;
    }
  });

  test("wraps when env var set", async () => {
    const path = join(dir, "envwrap.jsonl");
    process.env.ODDJOB_RECORD_FIXTURE = path;
    try {
      const wrapped = maybeRecordingFromEnv(fauxStream("hi"));
      const model = makeModel("gpt-4o-mini");
      await drain(wrapped(model, { messages: [], tools: [] }, undefined));
      const raw = await readFile(path, "utf8");
      expect(raw.split("\n").filter((l) => l.length > 0)).toHaveLength(1);
    } finally {
      delete process.env.ODDJOB_RECORD_FIXTURE;
    }
  });
});
