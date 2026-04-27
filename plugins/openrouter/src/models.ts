// Curated OpenRouter catalog. OpenRouter exposes hundreds of vendors, so the
// bundled list is conservative — refreshCatalog() pulls the live catalog when
// a key is configured.
//
// IDs use OpenRouter's `<vendor>/<model>` form because that's what OpenRouter's
// own API expects.

import type { ModelInfo } from "@oddjob/sdk";

export const OPENROUTER_MODELS: readonly ModelInfo[] = [
  {
    id: "anthropic/claude-opus-4-7",
    displayName: "Claude Opus 4.7 (OpenRouter)",
    contextWindow: 1_000_000,
    maxOutput: 64_000,
    inputCostPerMillion: 15,
    outputCostPerMillion: 75,
    supports: { tools: true, streaming: true, vision: true, reasoning: true },
    family: "claude-4",
  },
  {
    id: "anthropic/claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6 (OpenRouter)",
    contextWindow: 1_000_000,
    maxOutput: 64_000,
    inputCostPerMillion: 3,
    outputCostPerMillion: 15,
    supports: { tools: true, streaming: true, vision: true, reasoning: true },
    family: "claude-4",
  },
  {
    id: "openai/gpt-5",
    displayName: "GPT-5 (OpenRouter)",
    contextWindow: 400_000,
    maxOutput: 128_000,
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10,
    supports: { tools: true, streaming: true, vision: true, reasoning: true },
    family: "gpt-5",
  },
  {
    id: "openai/gpt-4o",
    displayName: "GPT-4o (OpenRouter)",
    contextWindow: 128_000,
    maxOutput: 16_384,
    inputCostPerMillion: 2.5,
    outputCostPerMillion: 10,
    supports: { tools: true, streaming: true, vision: true, reasoning: false },
    family: "gpt-4",
  },
  {
    id: "google/gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro (OpenRouter)",
    contextWindow: 1_000_000,
    maxOutput: 64_000,
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10,
    supports: { tools: true, streaming: true, vision: true, reasoning: true },
    family: "gemini-2.5",
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    displayName: "Llama 3.3 70B Instruct (OpenRouter)",
    contextWindow: 131_072,
    maxOutput: 16_384,
    inputCostPerMillion: 0.4,
    outputCostPerMillion: 0.4,
    supports: { tools: true, streaming: true, vision: false, reasoning: false },
    family: "llama-3",
  },
] as const;
