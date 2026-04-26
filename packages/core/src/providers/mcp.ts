import type { Connector } from "../types/connector.ts";
import type { ToolCall, ToolDefinition, ToolResult } from "../types/tool.ts";
import type { Provider } from "./base.ts";

export interface McpProvider extends Provider {
  open(
    connectorId: string,
    connector: Connector,
    getToken: () => Promise<string | null>,
  ): Promise<McpSession>;
}

export interface McpSession {
  readonly connectorId: string;
  listTools(): Promise<ToolDefinition[]>;
  callTool(call: ToolCall): Promise<ToolResult>;
  close(): Promise<void>;
}
