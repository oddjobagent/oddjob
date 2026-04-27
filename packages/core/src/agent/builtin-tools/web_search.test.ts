import { describe, expect, test } from "bun:test";

import { createWebSearchTool } from "./web_search.ts";

describe("web_search dispatcher", () => {
  test("errors when no plugin is configured", async () => {
    const tool = createWebSearchTool();
    const r = await tool.execute("c1", { query: "anything" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("not configured");
  });

  test("errors when plugin slug doesn't resolve in registry", async () => {
    const tool = createWebSearchTool({
      config: { plugin: "made-up" },
    });
    const r = await tool.execute("c1", { query: "x" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    // Without a registry, dispatcher reports registry unavailable.
    expect(text).toContain("plugin registry unavailable");
  });
});
