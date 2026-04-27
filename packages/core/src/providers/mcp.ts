import type { Connector } from "../types/connector.ts";
import type { ToolCall, ToolDefinition, ToolResult } from "../types/tool.ts";
import type { Provider } from "./base.ts";

export interface McpOpenOptions {
  /**
   * Forces a fresh token fetch (used after a 401 to get a refreshed token).
   * Implementations should pass this through to their auth-resolution callback.
   */
  forceRefresh?: boolean;
}

export type McpGetTokenFn = (opts?: McpOpenOptions) => Promise<string | null>;

export interface McpProvider extends Provider {
  open(
    connectorId: string,
    connector: Connector,
    getToken: McpGetTokenFn,
    callbacks?: McpProviderCallbacks,
  ): Promise<McpSession>;
}

export interface McpProviderCallbacks {
  /**
   * Fired when a refreshed token still gets 401 — the connector needs the
   * user to re-run the OAuth consent flow. Optional; absence is fine for
   * connectors with no auth or for callers that don't dispatch notifications.
   */
  onReauthNeeded?: (connectorId: string) => Promise<void> | void;
}

export interface McpSession {
  readonly connectorId: string;
  listTools(): Promise<ToolDefinition[]>;
  callTool(call: ToolCall): Promise<ToolResult>;
  close(): Promise<void>;
}
