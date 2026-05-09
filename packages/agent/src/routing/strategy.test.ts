// Unit tests for routing strategies (Phase 2 of agent_core_eval).
// Strategies are pure given a RoutingContext; tests stub `classify` and
// `resolveModel` so we can assert the decision shape without an LLM call.

import { describe, expect, test } from "bun:test";

import type { Blueprint } from "@oddjob/core";

import type { ResolvedLLM } from "../loop.ts";

import { createClassifierStrategy } from "./classifier.ts";
import { createFixedStrategy } from "./fixed.ts";
import { resolveStrategy } from "./index.ts";
import type { RoutingContext } from "./strategy.ts";

const fakeBlueprint = {
  id: "test/bp",
  prompt: "Solve the user's task.",
} as unknown as Blueprint;

const fakeLlm: ResolvedLLM = {
  model: { id: "claude-sonnet-4-6", provider: "anthropic" } as ResolvedLLM["model"],
  apiKey: "sk-test",
};

function makeCtx(opts: {
  classify?: (prompt: string, copts?: { model?: string; maxTokens?: number }) => Promise<string>;
  resolveModel?: (id: string) => Promise<ResolvedLLM>;
  input?: unknown;
}): RoutingContext {
  return {
    blueprint: fakeBlueprint,
    input: opts.input ?? "extract emails from this html",
    async resolveModel(id: string) {
      if (opts.resolveModel) return opts.resolveModel(id);
      return {
        model: { id, provider: fakeLlm.model.provider } as ResolvedLLM["model"],
        apiKey: fakeLlm.apiKey,
      };
    },
    async classify(prompt: string, copts?: { model?: string; maxTokens?: number }) {
      if (opts.classify) return opts.classify(prompt, copts);
      return "standard";
    },
  };
}

describe("fixed strategy", () => {
  test("never returns an llm; reason is documented", async () => {
    const s = createFixedStrategy();
    const d = await s.selectInitial(makeCtx({}));
    expect(s.name).toBe("fixed");
    expect(d.llm).toBeUndefined();
    expect(d.reason).toContain("blueprint default");
  });
});

describe("classifier strategy", () => {
  test("'simple' label maps to the simple-tier model", async () => {
    const s = createClassifierStrategy({
      tiers: { simple: "claude-haiku-4-5", standard: "claude-sonnet-4-6", complex: "claude-opus-4" },
    });
    const d = await s.selectInitial(makeCtx({ classify: async () => "simple" }));
    expect(d.llm).toBeDefined();
    expect(d.llm!.model.id).toBe("claude-haiku-4-5");
    expect(d.reason).toContain("simple");
    expect(d.meta).toMatchObject({ strategy: "classifier", label: "simple", mappedModel: "claude-haiku-4-5" });
  });

  test("'standard' with no tier mapping falls back to blueprint default", async () => {
    const s = createClassifierStrategy({
      tiers: { simple: "claude-haiku-4-5" }, // no standard mapping
    });
    const d = await s.selectInitial(makeCtx({ classify: async () => "standard" }));
    expect(d.llm).toBeUndefined();
    expect(d.reason).toContain("standard");
    expect(d.meta).toMatchObject({ strategy: "classifier", label: "standard" });
  });

  test("non-label classifier output falls back + records rawLabel", async () => {
    const warnings: string[] = [];
    const s = createClassifierStrategy({
      tiers: { simple: "claude-haiku-4-5" },
      onWarn: (msg) => warnings.push(msg),
    });
    const d = await s.selectInitial(
      makeCtx({ classify: async () => "I think this is simple but actually" }),
    );
    expect(d.llm).toBeUndefined();
    expect(d.meta?.rawLabel).toBeDefined();
    expect(warnings.length).toBe(1);
  });

  test("classify call failure falls back without throwing", async () => {
    const warnings: string[] = [];
    const s = createClassifierStrategy({
      tiers: { simple: "claude-haiku-4-5" },
      onWarn: (msg) => warnings.push(msg),
    });
    const d = await s.selectInitial(
      makeCtx({
        classify: async () => {
          throw new Error("network down");
        },
      }),
    );
    expect(d.llm).toBeUndefined();
    expect(d.reason).toContain("error");
    expect(d.meta?.error).toBe("network down");
    expect(warnings[0]).toContain("network down");
  });

  test("resolveModel failure falls back with mappedModel in meta", async () => {
    const warnings: string[] = [];
    const s = createClassifierStrategy({
      tiers: { complex: "gpt-9999-not-real" },
      onWarn: (msg) => warnings.push(msg),
    });
    const d = await s.selectInitial(
      makeCtx({
        classify: async () => "complex",
        resolveModel: async () => {
          throw new Error("model not found");
        },
      }),
    );
    expect(d.llm).toBeUndefined();
    expect(d.meta).toMatchObject({ label: "complex", mappedModel: "gpt-9999-not-real" });
    expect(warnings[0]).toContain("model not found");
  });

  test("uses configured classifierModel when calling classify", async () => {
    let capturedModel: string | undefined;
    const s = createClassifierStrategy({
      tiers: { simple: "claude-haiku-4-5" },
      classifierModel: "claude-haiku-3-5",
    });
    await s.selectInitial(
      makeCtx({
        classify: async (_p, copts) => {
          capturedModel = copts?.model;
          return "simple";
        },
      }),
    );
    expect(capturedModel).toBe("claude-haiku-3-5");
  });

  test("parses 'Standard.' (with punctuation/case) correctly", async () => {
    const s = createClassifierStrategy({
      tiers: { standard: "claude-sonnet-4-6" },
    });
    const d = await s.selectInitial(makeCtx({ classify: async () => "Standard." }));
    expect(d.llm?.model.id).toBe("claude-sonnet-4-6");
  });

  test("caps classifier input preview at 2KB (codex round-17 #4)", async () => {
    let capturedPrompt = "";
    const s = createClassifierStrategy({
      tiers: { simple: "claude-haiku-4-5" },
    });
    const huge = "x".repeat(10 * 1024); // 10 KB input
    await s.selectInitial(
      makeCtx({
        input: huge,
        classify: async (prompt) => {
          capturedPrompt = prompt;
          return "simple";
        },
      }),
    );
    expect(capturedPrompt.length).toBeLessThan(8 * 1024);
    expect(capturedPrompt).toContain("truncated");
  });
});

describe("resolveStrategy factory", () => {
  test("undefined config → fixed", async () => {
    const s = resolveStrategy(undefined);
    expect(s.name).toBe("fixed");
  });

  test("strategy=classifier returns classifier", async () => {
    const s = resolveStrategy({ strategy: "classifier", tiers: { simple: "claude-haiku-4-5" } });
    expect(s.name).toBe("classifier");
  });

  test("unknown strategy name falls back to fixed with warning", async () => {
    const warns: string[] = [];
    const s = resolveStrategy({ strategy: "bogus" as never }, { onWarn: (m) => warns.push(m) });
    expect(s.name).toBe("fixed");
    expect(warns[0]).toContain("bogus");
  });
});
