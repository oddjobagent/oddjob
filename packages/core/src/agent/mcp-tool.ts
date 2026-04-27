import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { TSchema } from "typebox";

import type {
  AuthProvider,
  Blueprint,
  McpProvider,
  McpProviderCallbacks,
  McpSession,
  SecretsProvider,
} from "../index.ts";

export interface McpToolBuilderOptions {
  blueprint: Blueprint;
  mcp?: McpProvider;
  secrets?: SecretsProvider;
  auth?: AuthProvider;
  /** Used to namespace OAuth tokens per deployment. */
  deploymentId?: string;
  /**
   * Fired when an MCP call hits 401 even after a forced refresh — caller
   * dispatches a reauth-needed notification through the deployment's
   * channels. Receives the fully-namespaced token key
   * (`<deploymentId>:<connectorName>`) so the dispatcher can resolve the
   * deployment + connector from state.
   */
  onReauthNeeded?: (tokenKey: string) => Promise<void> | void;
}

export interface McpRuntime {
  tools: AgentTool<TSchema>[];
  sessions: McpSession[];
  close: () => Promise<void>;
}

export async function buildMcpRuntime(opts: McpToolBuilderOptions): Promise<McpRuntime> {
  const sessions: McpSession[] = [];
  const tools: AgentTool<TSchema>[] = [];
  if (!opts.mcp) {
    return { tools, sessions, close: async () => {} };
  }

  for (const [connectorId, connector] of Object.entries(opts.blueprint.connectors)) {
    const tokenKey = `${opts.deploymentId ?? "_global"}:${connectorId}`;
    const callbacks: McpProviderCallbacks | undefined = opts.onReauthNeeded
      ? {
          onReauthNeeded: (_id) => opts.onReauthNeeded!(tokenKey),
        }
      : undefined;
    const session = await opts.mcp.open(
      connectorId,
      connector,
      async (callOpts) => {
        const auth = connector.auth;
        if (auth.kind === "api_key" || auth.kind === "bearer") {
          if (opts.secrets) {
            const v = await opts.secrets.get(auth.secretRef);
            if (v) return v;
          }
          return process.env[auth.secretRef] ?? null;
        }
        if (auth.kind === "oauth2") {
          if (!opts.auth) return null;
          try {
            return await opts.auth.refreshIfNeeded(tokenKey, { force: callOpts?.forceRefresh });
          } catch {
            return null;
          }
        }
        return null;
      },
      callbacks,
    );
    sessions.push(session);

    const remoteTools = await session.listTools();
    for (const t of remoteTools) {
      tools.push({
        name: t.name,
        label: t.name,
        description: t.description,
        parameters: t.inputSchema as unknown as TSchema,
        async execute(toolCallId, params): Promise<AgentToolResult<unknown>> {
          const r = await session.callTool({
            id: toolCallId,
            name: t.name,
            input: (params ?? {}) as Record<string, unknown>,
          });
          return {
            content: [{ type: "text", text: r.content }],
            details: { isError: r.isError, durationMs: r.durationMs },
          };
        },
      });
    }
  }

  return {
    tools,
    sessions,
    async close() {
      for (const s of sessions) await s.close().catch(() => undefined);
    },
  };
}
