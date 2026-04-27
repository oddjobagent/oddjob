import { describe, expect, test } from "bun:test";

import { DEFAULT_LIMITS } from "@oddjob/core";

import { definePlugin } from "./index.ts";

describe("@oddjob/sdk canary", () => {
  test("re-exports core", () => {
    expect(DEFAULT_LIMITS).toBeDefined();
  });

  test("definePlugin builds a plugin with services", () => {
    const plugin = definePlugin({ slug: "test-x", version: "0.0.1", description: "x" }, (b) => {
      b.modelProvider({
        id: "test-x",
        displayName: "Test X",
        capabilities: { tools: true, streaming: true, vision: false, reasoning: false },
        listModels: () => [],
        createClient: () => {
          throw new Error("not implemented");
        },
      });
    });
    expect(plugin.manifest.slug).toBe("test-x");
    expect(plugin.services).toHaveLength(1);
    expect(plugin.services[0]?.kind).toBe("model-provider");
  });
});
