// Conversion helpers between pi-ai's Model<TApi> and oddjob's ModelInfo /
// ResolvedRoleModel shapes. Centralised so all providers stay consistent.

import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelCapabilities, ModelInfo } from "@oddjob/sdk";

export function toModelInfo<TApi extends Api>(m: Model<TApi>): ModelInfo {
  const supports: ModelCapabilities = {
    tools: true,
    streaming: true,
    vision: m.input.includes("image"),
    reasoning: m.reasoning,
  };
  return {
    id: m.id,
    displayName: m.name,
    contextWindow: m.contextWindow,
    maxOutput: m.maxTokens,
    inputCostPerMillion: m.cost.input * 1_000_000,
    outputCostPerMillion: m.cost.output * 1_000_000,
    cachedInputCostPerMillion: m.cost.cacheRead * 1_000_000,
    supports,
  };
}

/**
 * Apply a credential's custom baseUrl to a Model. pi-ai's registry-built
 * Model carries a default baseUrl; users routing through Azure/proxy/etc.
 * supply their own via credential.options.baseUrl or credential.baseUrl.
 */
export function applyCustomBaseUrl<TApi extends Api>(
  model: Model<TApi>,
  customBase: string | undefined,
): Model<TApi> {
  if (!customBase) return model;
  return { ...model, baseUrl: customBase };
}

export function readCustomBaseUrl(
  options: Record<string, unknown> | undefined,
  fallback: string | undefined,
): string | undefined {
  const opt = options?.baseUrl ?? options?.base_url;
  if (typeof opt === "string") return opt;
  return fallback;
}
