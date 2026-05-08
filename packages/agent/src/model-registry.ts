// Model registry adapter over pi-ai's getProviders/getModels.
//
// pi-ai (`@mariozechner/pi-ai`) ships an auto-generated registry covering
// Anthropic, OpenAI, OpenRouter, Google, Mistral, Bedrock, Deepseek, Groq,
// Cerebras, X.AI, Kimi, and Vercel AI Gateway. We expose a flat, dashboard-
// friendly view of it: provider grouping, capability flags, cost+context
// metadata. The HTTP API surfaces this at GET /api/v1/models so the engine
// settings UI can render a real model picker instead of a hand-curated list.

import { getModels, getProviders, type Api, type Model } from "@mariozechner/pi-ai";

import { loadCuration, type Curation } from "./curation/index.ts";

export interface ModelDescriptor {
  /** Fully-qualified id used as the blueprint `model` string (provider/id). */
  id: string;
  /** Bare model id within the provider (e.g. "claude-opus-4"). */
  modelId: string;
  /** Provider slug (e.g. "anthropic", "openai", "openrouter"). */
  provider: string;
  /** Human-friendly display name (from pi-ai). */
  displayName: string;
  /** Pi-ai API kind ("anthropic-messages", "openai-responses", etc.). */
  api: Api;
  /** Whether the model supports a separate reasoning channel. */
  reasoning: boolean;
  /** Input modalities supported (text always; image when vision is supported). */
  input: ReadonlyArray<"text" | "image">;
  /** Token costs per 1M (input, output, cache read, cache write). */
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  releasedAt?: string;
  knowledgeCutoff?: string;
  recommended?: boolean;
  deprecatedAt?: string;
}

export interface ProviderDescriptor {
  /** Provider slug as known to pi-ai. */
  slug: string;
  /** Number of models pi-ai has for this provider. */
  modelCount: number;
}

function toDescriptor(provider: string, m: Model<Api>, curation: Curation): ModelDescriptor {
  const enrichment = curation.enrich(provider, m.id);
  return {
    id: `${provider}/${m.id}`,
    modelId: m.id,
    provider,
    displayName: m.name,
    api: m.api,
    reasoning: m.reasoning,
    input: m.input,
    cost: m.cost,
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
    ...(enrichment.releasedAt ? { releasedAt: enrichment.releasedAt } : {}),
    ...(enrichment.knowledgeCutoff ? { knowledgeCutoff: enrichment.knowledgeCutoff } : {}),
    ...(enrichment.recommended ? { recommended: true } : {}),
  };
}

/** All built-in models from pi-ai, flattened with provider prefix and enriched
 * via curation (models.dev release dates + hand-curated `recommended` flag). */
export async function listAllModels(): Promise<ModelDescriptor[]> {
  const curation = await loadCuration();
  const out: ModelDescriptor[] = [];
  for (const provider of getProviders()) {
    for (const m of getModels(provider)) {
      out.push(toDescriptor(provider, m as Model<Api>, curation));
    }
  }
  return out;
}

/** Provider slugs + their model counts. */
export function listProviders(): ProviderDescriptor[] {
  return getProviders().map((slug) => ({
    slug,
    modelCount: getModels(slug).length,
  }));
}
