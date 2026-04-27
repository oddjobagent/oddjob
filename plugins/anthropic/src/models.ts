// Bundled Anthropic catalog. Prices in USD per 1M tokens.

import type { ModelInfo } from "@oddjob/sdk";

export const ANTHROPIC_MODELS: readonly ModelInfo[] = [
  {
    id: "claude-opus-4-7",
    displayName: "Claude Opus 4.7",
    contextWindow: 1_000_000,
    maxOutput: 64_000,
    inputCostPerMillion: 15,
    outputCostPerMillion: 75,
    cachedInputCostPerMillion: 1.5,
    supports: { tools: true, streaming: true, vision: true, reasoning: true },
    family: "claude-4",
  },
  {
    id: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    contextWindow: 1_000_000,
    maxOutput: 64_000,
    inputCostPerMillion: 3,
    outputCostPerMillion: 15,
    cachedInputCostPerMillion: 0.3,
    supports: { tools: true, streaming: true, vision: true, reasoning: true },
    family: "claude-4",
  },
  {
    id: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    contextWindow: 200_000,
    maxOutput: 32_000,
    inputCostPerMillion: 1,
    outputCostPerMillion: 5,
    cachedInputCostPerMillion: 0.1,
    supports: { tools: true, streaming: true, vision: true, reasoning: false },
    family: "claude-4",
  },
  {
    id: "claude-opus-4",
    displayName: "Claude Opus 4",
    contextWindow: 200_000,
    maxOutput: 32_000,
    inputCostPerMillion: 15,
    outputCostPerMillion: 75,
    supports: { tools: true, streaming: true, vision: true, reasoning: true },
    family: "claude-4",
  },
  {
    id: "claude-sonnet-4",
    displayName: "Claude Sonnet 4",
    contextWindow: 200_000,
    maxOutput: 32_000,
    inputCostPerMillion: 3,
    outputCostPerMillion: 15,
    supports: { tools: true, streaming: true, vision: true, reasoning: false },
    family: "claude-4",
  },
] as const;
