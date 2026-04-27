// @oddjob/plugin-anthropic — Anthropic Claude model provider.

import { type Api, getModel as piGetModel, type Model } from "@mariozechner/pi-ai";

import {
  definePlugin,
  type ModelInfo,
  type ProviderCredential,
  type ResolvedRoleModel,
} from "@oddjob/sdk";

import { ANTHROPIC_MODELS } from "./models.ts";

const DEFAULT_BASE_URL = "https://api.anthropic.com";

function tryRegistry(modelId: string): Model<Api> | undefined {
  try {
    return piGetModel("anthropic" as never, modelId as never) as Model<Api>;
  } catch {
    return undefined;
  }
}

function buildModel(
  modelId: string,
  baseUrl: string,
  info?: ModelInfo,
): Model<"anthropic-messages"> {
  const display = info?.displayName ?? modelId;
  return {
    id: modelId,
    name: display,
    api: "anthropic-messages",
    provider: "anthropic",
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
    maxTokens: info?.maxOutput ?? 32_000,
  };
}

export default definePlugin(
  {
    slug: "anthropic",
    name: "Anthropic",
    description: "Official Anthropic Claude model provider.",
    version: "0.1.0",
    author: "Oddjob",
    homepage: "https://www.anthropic.com/",
  },
  (b) => {
    b.modelProvider({
      id: "anthropic",
      displayName: "Anthropic",
      authHint: "ANTHROPIC_API_KEY (optionally baseUrl for proxy).",
      capabilities: { tools: true, streaming: true, vision: true, reasoning: true },
      listModels: () => ANTHROPIC_MODELS,
      createClient: (modelId: string, credential: ProviderCredential): ResolvedRoleModel => {
        const info = ANTHROPIC_MODELS.find((m) => m.id === modelId);
        const optBase = credential.options?.baseUrl ?? credential.options?.base_url;
        const customBase = typeof optBase === "string" ? optBase : credential.baseUrl;
        const baseUrl = customBase ?? DEFAULT_BASE_URL;
        const model =
          customBase === undefined
            ? (tryRegistry(modelId) ?? buildModel(modelId, baseUrl, info))
            : buildModel(modelId, baseUrl, info);
        return { model, apiKey: credential.apiKey, info };
      },
    });
  },
);
