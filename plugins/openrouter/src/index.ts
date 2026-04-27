// @oddjob/plugin-openrouter — OpenRouter multi-vendor proxy.
//
// Models are addressed as `<vendor>/<model>` (e.g. `openai/gpt-4o`).

import type { Model } from "@mariozechner/pi-ai";

import {
  definePlugin,
  type ModelInfo,
  type ModelListContext,
  type ProviderCredential,
  type ResolvedRoleModel,
} from "@oddjob/sdk";

import { OPENROUTER_MODELS } from "./models.ts";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

function buildModel(
  modelId: string,
  baseUrl: string,
  info?: ModelInfo,
): Model<"openai-completions"> {
  return {
    id: modelId,
    name: info?.displayName ?? `${modelId} (OpenRouter)`,
    api: "openai-completions",
    provider: "openrouter",
    baseUrl,
    reasoning: info?.supports.reasoning ?? false,
    input: ["text"],
    cost: {
      input: (info?.inputCostPerMillion ?? 0) / 1_000_000,
      output: (info?.outputCostPerMillion ?? 0) / 1_000_000,
      cacheRead: (info?.cachedInputCostPerMillion ?? 0) / 1_000_000,
      cacheWrite: 0,
    },
    contextWindow: info?.contextWindow ?? 200_000,
    maxTokens: info?.maxOutput ?? 16_384,
  };
}

interface OpenRouterModelRow {
  id?: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string | number; completion?: string | number };
  architecture?: { input_modalities?: string[]; modality?: string };
  supported_parameters?: string[];
}

async function refreshFromOpenRouter(ctx: ModelListContext): Promise<readonly ModelInfo[]> {
  const cred = ctx.credential;
  const baseUrl =
    typeof cred?.options?.baseUrl === "string"
      ? (cred.options.baseUrl as string)
      : (cred?.baseUrl ?? DEFAULT_BASE_URL);
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: cred?.apiKey ? { authorization: `Bearer ${cred.apiKey}` } : undefined,
      signal: ctx.signal,
    });
    if (!res.ok) return OPENROUTER_MODELS;
    const body = (await res.json()) as { data?: OpenRouterModelRow[] };
    if (!body.data) return OPENROUTER_MODELS;
    const merged: ModelInfo[] = [];
    for (const row of body.data) {
      if (!row.id) continue;
      const inputPrice = priceUsdPerMillion(row.pricing?.prompt);
      const outputPrice = priceUsdPerMillion(row.pricing?.completion);
      const supportsTools = (row.supported_parameters ?? []).includes("tools");
      merged.push({
        id: row.id,
        displayName: row.name ?? row.id,
        contextWindow: row.context_length ?? 0,
        maxOutput: 0,
        inputCostPerMillion: inputPrice,
        outputCostPerMillion: outputPrice,
        supports: {
          tools: supportsTools,
          streaming: true,
          vision: (row.architecture?.input_modalities ?? []).includes("image"),
          reasoning: (row.supported_parameters ?? []).includes("reasoning"),
        },
        family: row.id.split("/")[0],
      });
    }
    return merged.length > 0 ? merged : OPENROUTER_MODELS;
  } catch {
    return OPENROUTER_MODELS;
  }
}

function priceUsdPerMillion(raw: string | number | undefined): number {
  if (raw === undefined) return 0;
  const n = typeof raw === "string" ? Number.parseFloat(raw) : raw;
  if (!Number.isFinite(n)) return 0;
  // OpenRouter pricing is per token in USD; convert to per million.
  return n * 1_000_000;
}

export default definePlugin(
  {
    slug: "openrouter",
    name: "OpenRouter",
    description: "Unified multi-vendor proxy with one key.",
    version: "0.1.0",
    author: "Oddjob",
    homepage: "https://openrouter.ai/",
  },
  (b) => {
    b.modelProvider({
      id: "openrouter",
      displayName: "OpenRouter",
      authHint: "OPENROUTER_API_KEY (one key, many vendors).",
      capabilities: { tools: true, streaming: true, vision: true, reasoning: true },
      listModels: () => OPENROUTER_MODELS,
      refreshCatalog: refreshFromOpenRouter,
      createClient: (modelId: string, credential: ProviderCredential): ResolvedRoleModel => {
        const info = OPENROUTER_MODELS.find((m) => m.id === modelId);
        const baseUrl =
          typeof credential.options?.baseUrl === "string"
            ? (credential.options.baseUrl as string)
            : (credential.baseUrl ?? DEFAULT_BASE_URL);
        return { model: buildModel(modelId, baseUrl, info), apiKey: credential.apiKey, info };
      },
    });
  },
);
