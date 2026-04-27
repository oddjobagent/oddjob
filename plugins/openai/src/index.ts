// @oddjob/plugin-openai — OpenAI model provider plugin.
//
// Wraps @mariozechner/pi-ai. Bundled catalog with prices; optional live
// refresh from /v1/models when the user supplies a working key.

import { type Api, getModel as piGetModel, type Model } from "@mariozechner/pi-ai";

import {
  definePlugin,
  type ModelInfo,
  type ModelListContext,
  type ProviderCredential,
  type ResolvedRoleModel,
} from "@oddjob/sdk";

import { OPENAI_MODELS } from "./models.ts";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function tryRegistry(modelId: string): Model<Api> | undefined {
  try {
    return piGetModel("openai" as never, modelId as never) as Model<Api>;
  } catch {
    return undefined;
  }
}

function buildModel(
  modelId: string,
  baseUrl: string,
  info?: ModelInfo,
): Model<"openai-completions"> {
  const display = info?.displayName ?? modelId;
  return {
    id: modelId,
    name: display,
    api: "openai-completions",
    provider: "openai",
    baseUrl,
    reasoning: info?.supports.reasoning ?? false,
    input: ["text"],
    cost: {
      input: (info?.inputCostPerMillion ?? 0) / 1_000_000,
      output: (info?.outputCostPerMillion ?? 0) / 1_000_000,
      cacheRead: (info?.cachedInputCostPerMillion ?? 0) / 1_000_000,
      cacheWrite: 0,
    },
    contextWindow: info?.contextWindow ?? 128_000,
    maxTokens: info?.maxOutput ?? 16_384,
  };
}

async function refreshFromOpenAI(ctx: ModelListContext): Promise<readonly ModelInfo[]> {
  const cred = ctx.credential;
  if (!cred?.apiKey) return OPENAI_MODELS;
  const baseUrl =
    typeof cred.options?.baseUrl === "string"
      ? cred.options.baseUrl
      : (cred.baseUrl ?? DEFAULT_BASE_URL);
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${cred.apiKey}` },
      signal: ctx.signal,
    });
    if (!res.ok) return OPENAI_MODELS;
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    if (!body.data) return OPENAI_MODELS;
    // Merge live ids onto bundled metadata; unknown ids get a stub entry.
    const merged: ModelInfo[] = [];
    const seen = new Set<string>();
    for (const m of body.data) {
      const id = m.id;
      if (!id) continue;
      seen.add(id);
      const bundled = OPENAI_MODELS.find((x) => x.id === id);
      if (bundled) {
        merged.push(bundled);
      } else if (id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3")) {
        merged.push({
          id,
          displayName: id,
          contextWindow: 128_000,
          maxOutput: 16_384,
          inputCostPerMillion: 0,
          outputCostPerMillion: 0,
          supports: { tools: true, streaming: true, vision: false, reasoning: id.startsWith("o") },
        });
      }
    }
    // Keep bundled-only entries (deprecated etc) so UI never loses them.
    for (const b of OPENAI_MODELS) if (!seen.has(b.id)) merged.push(b);
    return merged;
  } catch {
    return OPENAI_MODELS;
  }
}

export default definePlugin(
  {
    slug: "openai",
    name: "OpenAI",
    description: "Official OpenAI model provider (GPT-4o, GPT-5, o1, o3).",
    version: "0.1.0",
    author: "Oddjob",
    homepage: "https://platform.openai.com/",
  },
  (b) => {
    b.modelProvider({
      id: "openai",
      displayName: "OpenAI",
      authHint: "OPENAI_API_KEY (optionally baseUrl for Azure / proxy).",
      capabilities: { tools: true, streaming: true, vision: true, reasoning: true },
      listModels: () => OPENAI_MODELS,
      refreshCatalog: refreshFromOpenAI,
      createClient: (modelId: string, credential: ProviderCredential): ResolvedRoleModel => {
        const info = OPENAI_MODELS.find((m) => m.id === modelId);
        const optBase = credential.options?.baseUrl ?? credential.options?.base_url;
        const customBase = typeof optBase === "string" ? optBase : credential.baseUrl;
        const baseUrl = customBase ?? DEFAULT_BASE_URL;
        // Only use pi-ai's registry when there's no custom baseUrl — otherwise
        // we'd silently route through api.openai.com instead of the user's
        // Azure / proxy endpoint.
        const model =
          customBase === undefined
            ? (tryRegistry(modelId) ?? buildModel(modelId, baseUrl, info))
            : buildModel(modelId, baseUrl, info);
        return { model, apiKey: credential.apiKey, info };
      },
    });
  },
);
