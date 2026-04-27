import { describe, expect, test } from "bun:test";
import { createWebSearchTool } from "./web_search.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createWebSearchTool", () => {
  test("refuses with helpful message when not configured", async () => {
    const tool = createWebSearchTool();
    const r = await tool.execute("c1", { query: "anything" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("not configured");
    expect(r.details.provider).toBe("none");
  });

  test("brave provider returns normalized results", async () => {
    const tool = createWebSearchTool({
      config: { provider: "brave", apiKey: "fake-key" },
      fetchImpl: ((url: string, init: RequestInit) => {
        expect(url).toContain("api.search.brave.com");
        expect((init.headers as Record<string, string>)["X-Subscription-Token"]).toBe("fake-key");
        return Promise.resolve(
          jsonResponse({
            web: {
              results: [{ title: "T1", url: "https://a.com", description: "snip <b>1</b>" }],
            },
          }),
        );
      }) as unknown as typeof fetch,
    });
    const r = await tool.execute("c1", { query: "x" }, undefined);
    expect(r.details.resultCount).toBe(1);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("T1");
    expect(text).toContain("snip 1");
  });

  test("tavily provider returns normalized results", async () => {
    const tool = createWebSearchTool({
      config: { provider: "tavily", apiKey: "fake" },
      fetchImpl: ((url: string) => {
        expect(url).toContain("tavily.com");
        return Promise.resolve(
          jsonResponse({
            results: [{ title: "T", url: "https://b.com", content: "ctx" }],
          }),
        );
      }) as unknown as typeof fetch,
    });
    const r = await tool.execute("c1", { query: "y" }, undefined);
    expect(r.details.resultCount).toBe(1);
  });

  test("searxng requires baseUrl", async () => {
    const tool = createWebSearchTool({ config: { provider: "searxng" } });
    const r = await tool.execute("c1", { query: "z" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("baseUrl");
  });
});
