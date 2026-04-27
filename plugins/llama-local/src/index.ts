// @oddjob/plugin-llama-local — Connect to a local OpenAI-compatible server
// (Ollama, LM Studio, llama.cpp server, vLLM, ...). Catalog is empty by
// default; refreshCatalog() probes the local server's /v1/models.

import type { Model } from "@mariozechner/pi-ai";

import {
  definePlugin,
  type ModelInfo,
  type ModelListContext,
  type ProviderCredential,
  type ResolvedRoleModel,
} from "@oddjob/sdk";

const DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";

/** A single zero-cost stub so the UI shows something before users probe. */
const BUNDLED_FALLBACK: readonly ModelInfo[] = [
  {
    id: "llama3.2",
    displayName: "Llama 3.2 (local)",
    contextWindow: 131_072,
    maxOutput: 8192,
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
    supports: { tools: true, streaming: true, vision: false, reasoning: false },
    family: "llama-3",
  },
];

function buildModel(
  modelId: string,
  baseUrl: string,
  info?: ModelInfo,
): Model<"openai-completions"> {
  return {
    id: modelId,
    name: info?.displayName ?? modelId,
    api: "openai-completions",
    provider: "llama-local",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: info?.contextWindow ?? 8192,
    maxTokens: info?.maxOutput ?? 4096,
  };
}

async function refreshFromServer(ctx: ModelListContext): Promise<readonly ModelInfo[]> {
  const cred = ctx.credential;
  const baseUrl =
    typeof cred?.options?.baseUrl === "string"
      ? (cred.options.baseUrl as string)
      : (cred?.baseUrl ?? DEFAULT_BASE_URL);
  try {
    const res = await fetch(`${baseUrl}/models`, { signal: ctx.signal });
    if (!res.ok) return BUNDLED_FALLBACK;
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    if (!body.data) return BUNDLED_FALLBACK;
    return body.data
      .filter((m): m is { id: string } => typeof m.id === "string")
      .map((m) => ({
        id: m.id,
        displayName: m.id,
        contextWindow: 8192,
        maxOutput: 4096,
        inputCostPerMillion: 0,
        outputCostPerMillion: 0,
        supports: { tools: true, streaming: true, vision: false, reasoning: false },
        family: m.id.split(":")[0],
      }));
  } catch {
    return BUNDLED_FALLBACK;
  }
}

export default definePlugin(
  {
    slug: "llama-local",
    name: "Local Llama (OpenAI-compatible)",
    description: "Talk to a local Ollama / LM Studio / llama.cpp server via the OpenAI API.",
    version: "0.1.0",
    author: "Oddjob",
    homepage: "https://ollama.com/",
  },
  (b) => {
    b.modelProvider({
      id: "llama-local",
      displayName: "Local Llama",
      authHint: "Optional. Default baseUrl is http://127.0.0.1:11434/v1 (Ollama).",
      capabilities: { tools: true, streaming: true, vision: false, reasoning: false },
      listModels: () => BUNDLED_FALLBACK,
      refreshCatalog: refreshFromServer,
      createClient: (modelId: string, credential: ProviderCredential): ResolvedRoleModel => {
        const baseUrl =
          typeof credential.options?.baseUrl === "string"
            ? (credential.options.baseUrl as string)
            : (credential.baseUrl ?? DEFAULT_BASE_URL);
        return {
          model: buildModel(modelId, baseUrl),
          apiKey: credential.apiKey ?? "ollama", // Ollama ignores the key but pi-ai sends a header.
        };
      },
    });
  },
);
