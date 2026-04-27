// Tests cover the raw fetcher's body handling (HTML→markdown, redirects,
// truncation, JSON pretty-print). The dispatcher's SSRF guard + plugin
// selection live in core and are tested separately.

import { describe, expect, test } from "bun:test";

import plugin from "./index.ts";
import { rawFetch } from "./raw.ts";

function mockFetch(handlers: Record<string, () => Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const handler = handlers[url];
    if (!handler) throw new Error(`unmocked fetch: ${url}`);
    return handler();
  }) as unknown as typeof fetch;
}

describe("web-fetch-core plugin", () => {
  test("registers raw + 3 paid backends", () => {
    const ids = plugin.services
      .filter((s) => s.kind === "web-fetch")
      .map((s) => (s.kind === "web-fetch" ? s.id : ""))
      .sort();
    expect(ids).toEqual(["browserbase", "firecrawl", "raw", "scrapingbee"]);
  });
});

describe("rawFetch", () => {
  test("returns body as text for text/plain", async () => {
    const fetchImpl = mockFetch({
      "https://1.1.1.1/": () =>
        new Response("hello world", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    });
    const r = await rawFetch("https://1.1.1.1/", {}, { fetchImpl });
    expect(r.status).toBe(200);
    expect(r.body).toContain("hello world");
    expect(r.format).toBe("text");
  });

  test("converts HTML to markdown by default", async () => {
    const fetchImpl = mockFetch({
      "https://1.1.1.1/": () =>
        new Response("<h1>Hi</h1><p>body</p>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    });
    const r = await rawFetch("https://1.1.1.1/", {}, { fetchImpl });
    expect(r.body).toContain("# Hi");
    expect(r.format).toBe("markdown");
  });

  test("truncates body to maxBytes", async () => {
    const big = "x".repeat(2_000_000);
    const fetchImpl = mockFetch({
      "https://1.1.1.1/": () =>
        new Response(big, { status: 200, headers: { "content-type": "text/plain" } }),
    });
    const r = await rawFetch("https://1.1.1.1/", {}, { fetchImpl, maxBytes: 1_000_000 });
    expect(r.truncated).toBe(true);
  });

  test("follows redirects up to limit then errors", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { location: `https://1.1.1.1/${calls}` },
      });
    }) as unknown as typeof fetch;
    await expect(rawFetch("https://1.1.1.1/", {}, { fetchImpl })).rejects.toThrow(
      /too many redirects/,
    );
  });

  test("pretty-prints JSON content", async () => {
    const fetchImpl = mockFetch({
      "https://1.1.1.1/": () =>
        new Response(JSON.stringify({ a: 1, b: [2, 3] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    const r = await rawFetch("https://1.1.1.1/", {}, { fetchImpl });
    expect(r.format).toBe("json");
    expect(r.body).toContain("\n  ");
  });
});
