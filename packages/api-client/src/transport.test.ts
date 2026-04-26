import { describe, expect, test } from "bun:test";

import { ApiError, createTransport } from "./transport.ts";

function fakeFetch(
  impl: (url: string, init: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return ((url: string, init: RequestInit = {}) =>
    Promise.resolve(impl(url, init))) as typeof fetch;
}

describe("createTransport", () => {
  test("composes baseUrl + path with no trailing slash", async () => {
    let receivedUrl = "";
    const r = createTransport({
      baseUrl: "http://localhost:7777/",
      fetch: fakeFetch((url) => {
        receivedUrl = url;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    });
    await r("GET", "/api/v1/health");
    expect(receivedUrl).toBe("http://localhost:7777/api/v1/health");
  });

  test("injects bearer token when configured", async () => {
    let received: Headers = new Headers();
    const r = createTransport({
      baseUrl: "http://localhost:7777",
      bearerToken: "tok",
      fetch: fakeFetch((_, init) => {
        received = new Headers(init.headers);
        return new Response(null, { status: 204 });
      }),
    });
    await r("GET", "/x");
    expect(received.get("authorization")).toBe("Bearer tok");
  });

  test("omits bearer header when token absent", async () => {
    let received: Headers = new Headers();
    const r = createTransport({
      baseUrl: "http://localhost:7777",
      fetch: fakeFetch((_, init) => {
        received = new Headers(init.headers);
        return new Response(null, { status: 204 });
      }),
    });
    await r("GET", "/x");
    expect(received.get("authorization")).toBeNull();
  });

  test("204 returns undefined", async () => {
    const r = createTransport({
      baseUrl: "http://localhost:7777",
      fetch: fakeFetch(() => new Response(null, { status: 204 })),
    });
    const result = await r<void>("DELETE", "/x");
    expect(result).toBeUndefined();
  });

  test("non-ok throws ApiError with status", async () => {
    const r = createTransport({
      baseUrl: "http://localhost:7777",
      fetch: fakeFetch(() => new Response("nope", { status: 404 })),
    });
    let err: unknown;
    try {
      await r("GET", "/missing");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toContain("nope");
  });

  test("JSON content-type triggers .json() parse", async () => {
    const r = createTransport({
      baseUrl: "http://localhost:7777",
      fetch: fakeFetch(
        () =>
          new Response(JSON.stringify({ items: [1, 2, 3] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    });
    const result = await r<{ items: number[] }>("GET", "/x");
    expect(result.items).toEqual([1, 2, 3]);
  });

  test("body is JSON-serialized + content-type header set", async () => {
    let received: { body: string; headers: Headers } = { body: "", headers: new Headers() };
    const r = createTransport({
      baseUrl: "http://localhost:7777",
      fetch: fakeFetch((_, init) => {
        received = { body: String(init.body), headers: new Headers(init.headers) };
        return new Response(null, { status: 204 });
      }),
    });
    await r("POST", "/x", { foo: "bar" });
    expect(received.body).toBe('{"foo":"bar"}');
    expect(received.headers.get("content-type")).toBe("application/json");
  });
});
