import { describe, expect, test } from "bun:test";

import { LlmPiProvider } from "./provider.ts";

describe("@oddjob/llm-pi canary", () => {
  test("provider class instantiates", () => {
    const p = new LlmPiProvider();
    expect(p.name).toBe("llm-pi");
  });
});
