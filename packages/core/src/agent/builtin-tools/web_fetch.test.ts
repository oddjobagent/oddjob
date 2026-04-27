import { describe, expect, test } from "bun:test";
import { createWebFetchTool } from "./web_fetch.ts";

function mockFetch(handlers: Record<string, () => Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const handler = handlers[url];
    if (!handler) throw new Error(`unmocked fetch: ${url}`);
    return handler();
  }) as unknown as typeof fetch;
}

describe("createWebFetchTool", () => {
  test("refuses private IPs by default", async () => {
    const tool = createWebFetchTool();
    const r = await tool.execute("c1", { url: "http://127.0.0.1/" }, undefined);
    expect(r.details.status).toBe(0);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("private");
  });

  test("returns body as text for text/plain", async () => {
    const tool = createWebFetchTool({
      fetchImpl: mockFetch({
        "https://1.1.1.1/": () =>
          new Response("hello world", {
            status: 200,
            headers: { "content-type": "text/plain" },
          }),
      }),
    });
    const r = await tool.execute("c1", { url: "https://1.1.1.1/" }, undefined);
    expect(r.details.status).toBe(200);
    expect(r.content.map((c) => (c.type === "text" ? c.text : "")).join("")).toContain(
      "hello world",
    );
  });

  test("converts HTML to markdown by default", async () => {
    const tool = createWebFetchTool({
      fetchImpl: mockFetch({
        "https://1.1.1.1/": () =>
          new Response("<h1>Hi</h1><p>body</p>", {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      }),
    });
    const r = await tool.execute("c1", { url: "https://1.1.1.1/" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("# Hi");
    expect(text).toContain("body");
  });

  test("truncates body to maxBodyMb", async () => {
    const big = "x".repeat(2 * 1024 * 1024);
    const tool = createWebFetchTool({
      config: { maxBodyMb: 1 },
      fetchImpl: mockFetch({
        "https://1.1.1.1/": () =>
          new Response(big, { status: 200, headers: { "content-type": "text/plain" } }),
      }),
    });
    const r = await tool.execute("c1", { url: "https://1.1.1.1/" }, undefined);
    expect(r.details.truncated).toBe(true);
    expect(r.details.bytesIn).toBe(1 * 1024 * 1024);
  });

  test("follows redirects up to limit then errors", async () => {
    let n = 0;
    const tool = createWebFetchTool({
      fetchImpl: (() => {
        n++;
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: `https://1.1.1.${n}/` },
          }),
        );
      }) as unknown as typeof fetch,
    });
    const r = await tool.execute("c1", { url: "https://1.1.1.1/" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("too many redirects");
  });
});
