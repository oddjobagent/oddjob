import { describe, expect, test } from "bun:test";

import plugin from "./index.ts";

describe("web-search-core canary", () => {
  test("registers 5 web-search services", () => {
    const services = plugin.services.filter((s) => s.kind === "web-search");
    const ids = services.map((s) => (s.kind === "web-search" ? s.id : "")).sort();
    expect(ids).toEqual(["brave", "exa", "searxng", "serpapi", "tavily"]);
  });

  test("brave search routes through fetchImpl + bearer header", async () => {
    const brave = plugin.services.find((s) => s.kind === "web-search" && s.id === "brave");
    if (!brave || brave.kind !== "web-search") throw new Error("brave service missing");
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      if (init?.headers) {
        for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
          headers[k.toLowerCase()] = v;
        }
      }
      calls.push({ url, headers });
      return new Response(
        JSON.stringify({
          web: {
            results: [{ title: "Result 1", url: "https://example.com/r1", description: "snip" }],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const results = await brave.search("hello world", { apiKey: "test-key" }, { fetchImpl });
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Result 1");
    expect(calls[0]?.headers["x-subscription-token"]).toBe("test-key");
    expect(calls[0]?.url).toContain("q=hello+world");
  });

  test("tavily search posts JSON body with api_key", async () => {
    const tavily = plugin.services.find((s) => s.kind === "web-search" && s.id === "tavily");
    if (!tavily || tavily.kind !== "web-search") throw new Error("tavily service missing");
    let bodySeen: string | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodySeen = init?.body as string | undefined;
      return new Response(
        JSON.stringify({
          results: [{ title: "T1", url: "https://example.com/t1", content: "tavily snip" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const results = await tavily.search("query", { apiKey: "tav-key" }, { fetchImpl });
    expect(results).toHaveLength(1);
    expect(JSON.parse(bodySeen!).api_key).toBe("tav-key");
  });
});
