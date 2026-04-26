import type { ToolCall, ToolResult } from "./tool.ts";

export type Role = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: Role;
  content: ContentBlock[];
}

export type ContentBlock = TextBlock | ToolCallBlock | ToolResultBlock | ThinkingBlock;

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolCallBlock {
  type: "tool_call";
  toolCall: ToolCall;
}

export interface ToolResultBlock {
  type: "tool_result";
  result: ToolResult;
}

export interface ThinkingBlock {
  type: "thinking";
  text: string;
}
