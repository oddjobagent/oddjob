import { describe, expect, test } from "bun:test";

import { LlmPiProvider } from "./provider.ts";

describe("LlmPiProvider.resolveModel", () => {
  test("parses openrouter/<vendor>/<model>", async () => {
    const p = new LlmPiProvider();
    const r = await p.resolveModel("openrouter/anthropic/claude-sonnet-4");
    expect(r.model.provider).toBe("openrouter");
    expect(r.model.id).toBe("anthropic/claude-sonnet-4");
    expect(r.model.api).toBe("openai-completions");
    expect(r.model.baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  test("parses faux model", async () => {
    const p = new LlmPiProvider();
    const r = await p.resolveModel("faux/test");
    expect(r.model.provider).toBe("faux");
    expect(r.model.id).toBe("test");
    expect(r.apiKey).toBeUndefined();
  });

  test("falls back to env var when no secret_ref", async () => {
    const prev = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    try {
      const p = new LlmPiProvider();
      const r = await p.resolveModel("openrouter/anthropic/claude-sonnet-4");
      expect(r.apiKey).toBe("sk-or-test");
    } finally {
      if (prev === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = prev;
    }
  });
});
