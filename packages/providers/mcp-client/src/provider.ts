import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

import type {
  Connector,
  HttpConnector,
  McpGetTokenFn,
  McpProvider,
  McpProviderCallbacks,
  McpSession,
  StdioConnector,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "@oddjob/core";

const CLIENT_INFO = { name: "oddjob", version: "0.0.0" };

export class McpClientProvider implements McpProvider {
  readonly name = "mcp-client";

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthy(): Promise<boolean> {
    return true;
  }

  async open(
    connectorId: string,
    connector: Connector,
    getToken: McpGetTokenFn,
    callbacks?: McpProviderCallbacks,
  ): Promise<McpSession> {
    const client = await openClientForConnector(connector, getToken);
    return new McpClientSession(connectorId, client, connector, getToken, callbacks);
  }
}

async function openClientForConnector(
  connector: Connector,
  getToken: McpGetTokenFn,
): Promise<Client> {
  const client = new Client(CLIENT_INFO, { capabilities: {} });
  if (connector.transport === "stdio") {
    const transport = makeStdioTransport(connector, await getToken());
    await client.connect(transport);
  } else {
    const transport = await makeHttpTransport(connector, await getToken());
    await client.connect(transport);
  }
  return client;
}

function makeStdioTransport(connector: StdioConnector, token: string | null): StdioClientTransport {
  // Stdio MCP servers conventionally read credentials from env. We inject the
  // resolved api_key/bearer token under the secret_ref name so blueprints
  // don't have to duplicate it via [connectors.x.env].
  const env: Record<string, string> = { ...process.env, ...connector.env } as Record<
    string,
    string
  >;
  if (token && (connector.auth.kind === "api_key" || connector.auth.kind === "bearer")) {
    const envName = connector.auth.kind === "api_key" ? connector.auth.headerName : undefined;
    const secretRef =
      connector.auth.kind === "api_key" ? connector.auth.secretRef : connector.auth.secretRef;
    const target = envName ?? secretRef;
    if (target && env[target] === undefined) env[target] = token;
  }
  return new StdioClientTransport({
    command: connector.command,
    args: connector.args,
    env,
  });
}

async function makeHttpTransport(
  connector: HttpConnector,
  token: string | null,
): Promise<StreamableHTTPClientTransport | SSEClientTransport> {
  const url = new URL(connector.server);
  const headers: Record<string, string> = { ...connector.env };
  if (token) headers.authorization = `Bearer ${token}`;
  if (connector.transport === "sse") {
    return new SSEClientTransport(url, {
      requestInit: { headers },
    });
  }
  return new StreamableHTTPClientTransport(url, {
    requestInit: { headers },
  });
}

export type McpClientFactory = (
  connector: Connector,
  getToken: McpGetTokenFn,
) => Promise<Client>;

export class McpClientSession implements McpSession {
  private client: Client;
  private readonly clientFactory: McpClientFactory;

  constructor(
    public readonly connectorId: string,
    initialClient: Client,
    private readonly connector: Connector,
    private readonly getToken: McpGetTokenFn,
    private readonly callbacks?: McpProviderCallbacks,
    clientFactory?: McpClientFactory,
  ) {
    this.client = initialClient;
    this.clientFactory = clientFactory ?? openClientForConnector;
  }

  private async reconnect(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      /* ignore */
    }
    this.client = await this.clientFactory(this.connector, this.getToken);
  }

  async listTools(): Promise<ToolDefinition[]> {
    const r = await this.client.listTools();
    const allowlist = new Set(this.connector.tools ?? []);
    return r.tools
      .filter((t) => allowlist.size === 0 || allowlist.has(t.name))
      .map((t) => ({
        name: prefixed(this.connectorId, t.name),
        description: (t.description as string | undefined) ?? `${this.connectorId} tool ${t.name}`,
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object" },
        source: { kind: "mcp", connector: this.connectorId, remoteName: t.name },
      }));
  }

  async callTool(call: ToolCall): Promise<ToolResult> {
    const remoteName = stripPrefix(this.connectorId, call.name);
    const start = Date.now();
    try {
      const result = await this.client.callTool({
        name: remoteName,
        arguments: call.input,
      });
      const text = stringifyContent(result.content as Array<{ type: string; text?: string }>);
      return {
        toolCallId: call.id,
        content: text,
        isError: Boolean(result.isError),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      if (!is401(err)) {
        return {
          toolCallId: call.id,
          content: (err as Error).message,
          isError: true,
          durationMs: Date.now() - start,
        };
      }
      // OAuth2 connectors only — other auth kinds can't be refreshed mid-session.
      if (this.connector.auth.kind !== "oauth2") {
        return {
          toolCallId: call.id,
          content: (err as Error).message,
          isError: true,
          durationMs: Date.now() - start,
        };
      }
      // Force a refresh and rebuild the transport so the retry uses the new token.
      // The MCP SDK reads requestInit.headers once at connect time; without a
      // reconnect the retry would re-send the stale Authorization header and
      // produce a spurious second 401.
      let reconnected = false;
      try {
        await this.getToken({ forceRefresh: true });
        await this.reconnect();
        reconnected = true;
      } catch {
        // refresh or reconnect threw → fall through to reauth notification
      }
      if (!reconnected) {
        try {
          await this.callbacks?.onReauthNeeded?.(this.connectorId);
        } catch {
          /* swallow */
        }
        return {
          toolCallId: call.id,
          content: (err as Error).message,
          isError: true,
          durationMs: Date.now() - start,
        };
      }
      try {
        const result = await this.client.callTool({
          name: remoteName,
          arguments: call.input,
        });
        const text = stringifyContent(result.content as Array<{ type: string; text?: string }>);
        return {
          toolCallId: call.id,
          content: text,
          isError: Boolean(result.isError),
          durationMs: Date.now() - start,
        };
      } catch (err2) {
        if (is401(err2)) {
          try {
            await this.callbacks?.onReauthNeeded?.(this.connectorId);
          } catch {
            /* swallow — never let dispatch errors crash a tool call */
          }
        }
        return {
          toolCallId: call.id,
          content: (err2 as Error).message,
          isError: true,
          durationMs: Date.now() - start,
        };
      }
    }
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      /* ignore */
    }
  }
}

function is401(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; status?: unknown; name?: unknown; message?: unknown };
  if (e.code === 401 || e.status === 401) return true;
  if (typeof e.name === "string" && e.name === "UnauthorizedError") return true;
  if (typeof e.message === "string" && /\b401\b|Unauthorized/i.test(e.message)) return true;
  return false;
}

function prefixed(connectorId: string, name: string): string {
  return `${connectorId}__${name}`;
}

function stripPrefix(connectorId: string, name: string): string {
  const prefix = `${connectorId}__`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

function stringifyContent(content: Array<{ type: string; text?: string }> | undefined): string {
  if (!content) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}
