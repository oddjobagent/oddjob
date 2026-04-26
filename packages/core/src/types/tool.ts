export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  source: ToolSource;
}

export type ToolSource =
  | { kind: "builtin"; name: string }
  | { kind: "script"; path: string }
  | { kind: "mcp"; connector: string; remoteName: string }
  | { kind: "skill"; skill: string };

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
  durationMs: number;
}
