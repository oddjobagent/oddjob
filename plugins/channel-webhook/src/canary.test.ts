import { describe, expect, test } from "bun:test";
import { ChannelWebhookProvider } from "./provider.ts";

describe("ChannelWebhookProvider", () => {
  test("requires channelConfig", async () => {
    const p = new ChannelWebhookProvider();
    await expect(p.send({ body: "hi", format: "text" })).rejects.toThrow(/channelConfig/);
  });

  test("posts to URL with HMAC", async () => {
    const p = new ChannelWebhookProvider();
    interface Captured {
      url: string;
      headers: Headers;
      body: string;
    }
    let received: Captured | null = null;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      received = {
        url: String(input),
        headers: new Headers(init?.headers ?? {}),
        body: String(init?.body),
      };
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    process.env.MY_HMAC = "supersecret";
    try {
      await p.send({
        body: "hello",
        format: "text",
        meta: {
          channelConfig: {
            type: "webhook",
            url: "https://example.com/hook",
            hmacSecretRef: "MY_HMAC",
          },
          runId: "r1",
        },
      });
      const r = received as Captured | null;
      expect(r?.url).toBe("https://example.com/hook");
      expect(r?.headers.get("x-oddjob-signature")).toMatch(/^[0-9a-f]{64}$/);
      const json = JSON.parse(r!.body);
      expect(json.run_id).toBe("r1");
      expect(json.body).toBe("hello");
    } finally {
      globalThis.fetch = origFetch;
      delete process.env.MY_HMAC;
    }
  });
});
