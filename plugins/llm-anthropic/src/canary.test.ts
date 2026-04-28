import { describe, expect, test } from "bun:test";

import { LlmAnthropicProvider } from "./provider.ts";

describe("@oddjob/llm-anthropic canary", () => {
  test("provider class instantiates", () => {
    const p = new LlmAnthropicProvider();
    expect(p.name).toBe("llm-anthropic");
  });
});
