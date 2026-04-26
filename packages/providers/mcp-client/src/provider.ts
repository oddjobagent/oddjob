import type { McpProvider } from "@oddjob/core";

export class McpClientProvider implements Partial<McpProvider> {
  readonly name = "mcp-client";

  async connect(): Promise<void> {
    throw new Error("mcp-client: not implemented");
  }

  async disconnect(): Promise<void> {
    return;
  }

  async healthy(): Promise<boolean> {
    return false;
  }
}
