import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

import type {
  Connector,
  HttpConnector,
  McpProvider,
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
    getToken: () => Promise<string | null>,
  ): Promise<McpSession> {
    const client = new Client(CLIENT_INFO, { capabilities: {} });
    if (connector.transport === "stdio") {
      const transport = makeStdioTransport(connector, await getToken());
      await client.connect(transport);
    } else {
      const transport = await makeHttpTransport(connector, await getToken());
      await client.connect(transport);
    }
    return new McpClientSession(connectorId, client, connector);
  }
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

class McpClientSession implements McpSession {
  constructor(
    public readonly connectorId: string,
    private readonly client: Client,
    private readonly connector: Connector,
  ) {}

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
      return {
        toolCallId: call.id,
        content: (err as Error).message,
        isError: true,
        durationMs: Date.now() - start,
      };
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
