import { describe, expect, test } from "bun:test";

import { ChannelConsoleProvider } from "./provider.ts";

describe("@oddjob/channel-console canary", () => {
  test("provider class instantiates", () => {
    const p = new ChannelConsoleProvider();
    expect(p.name).toBe("channel-console");
  });
});
