import { describe, expect, test } from "bun:test";

import { createWebFetchTool } from "./web_fetch.ts";

describe("web_fetch dispatcher", () => {
  test("refuses private IPs at the SSRF guard layer (no registry needed)", async () => {
    const tool = createWebFetchTool();
    const r = await tool.execute("c1", { url: "http://127.0.0.1/" }, undefined);
    expect(r.details.status).toBe(0);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text.toLowerCase()).toMatch(/private|loopback|blocked/);
  });

  test("errors when no plugin registry is supplied", async () => {
    const tool = createWebFetchTool();
    const r = await tool.execute("c1", { url: "https://1.1.1.1/" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("plugin registry unavailable");
  });
});
