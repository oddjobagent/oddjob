import type { LLMProvider } from "@oddjob/core";

export class LlmAnthropicProvider implements Partial<LLMProvider> {
  readonly name = "llm-anthropic";

  async connect(): Promise<void> {
    throw new Error("llm-anthropic: not implemented");
  }

  async disconnect(): Promise<void> {
    return;
  }

  async healthy(): Promise<boolean> {
    return false;
  }
}
