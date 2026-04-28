import { describe, expect, test } from "bun:test";

import { McpClientProvider } from "./provider.ts";

describe("McpClientProvider", () => {
  test("instantiates", () => {
    const p = new McpClientProvider();
    expect(p.name).toBe("mcp-client");
  });

  // Live MCP test: requires npx + network. Marked optional.
  test.skipIf(!process.env.ODDJOB_LIVE_MCP)(
    "connects to filesystem stdio MCP server",
    async () => {
      const p = new McpClientProvider();
      const session = await p.open(
        "fs",
        {
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
          auth: { kind: "none" },
        },
        async () => null,
      );
      const tools = await session.listTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools[0]?.name).toMatch(/^fs__/);
      await session.close();
    },
    30_000,
  );
});
