import { describe, expect, test } from "bun:test";

import { ChannelEmailProvider } from "./provider.ts";

describe("@oddjob/channel-email canary", () => {
  test("provider class instantiates", () => {
    const p = new ChannelEmailProvider();
    expect(p.name).toBe("channel-email");
  });
});
