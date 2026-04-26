import { describe, expect, test } from "bun:test";

import { ChannelSlackProvider } from "./provider.ts";

describe("@oddjob/channel-slack canary", () => {
  test("provider class instantiates", () => {
    const p = new ChannelSlackProvider();
    expect(p.name).toBe("channel-slack");
  });
});
