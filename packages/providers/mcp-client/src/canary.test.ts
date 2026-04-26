import { describe, expect, test } from "bun:test";

import { McpClientProvider } from "./provider.ts";

describe("@oddjob/mcp-client canary", () => {
  test("provider class instantiates", () => {
    const p = new McpClientProvider();
    expect(p.name).toBe("mcp-client");
  });
});
