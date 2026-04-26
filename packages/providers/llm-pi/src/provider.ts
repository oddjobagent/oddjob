import type { LLMProvider } from "@oddjob/core";

export class LlmPiProvider implements Partial<LLMProvider> {
  readonly name = "llm-pi";

  async connect(): Promise<void> {
    throw new Error("llm-pi: not implemented");
  }

  async disconnect(): Promise<void> {
    return;
  }

  async healthy(): Promise<boolean> {
    return false;
  }
}
