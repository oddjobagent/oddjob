import type { Message } from "../types/message.ts";
import type { ToolDefinition } from "../types/tool.ts";
import type { Provider } from "./base.ts";

export interface LLMProvider extends Provider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream?(request: ChatRequest): AsyncIterable<ChatChunk>;
}

export interface ChatRequest {
  model: string;
  systemPrompt: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  outputSchema?: Record<string, unknown>;
}

export interface ChatResponse {
  message: Message;
  usage: ChatUsage;
  stopReason: ChatStopReason;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export type ChatStopReason = "end_turn" | "tool_use" | "max_tokens" | "error";

export type ChatChunk =
  | { type: "text"; delta: string }
  | { type: "tool_call_delta"; toolCallId: string; nameDelta?: string; argsDelta?: string }
  | { type: "thinking"; delta: string }
  | { type: "done"; response: ChatResponse };
