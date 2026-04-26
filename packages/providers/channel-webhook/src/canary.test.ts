import { describe, expect, test } from "bun:test";

import { ChannelWebhookProvider } from "./provider.ts";

describe("@oddjob/channel-webhook canary", () => {
  test("provider class instantiates", () => {
    const p = new ChannelWebhookProvider();
    expect(p.name).toBe("channel-webhook");
  });
});
