// @oddjob/plugin-pi-models — single plugin that registers a
// ModelProviderService for every pi-ai built-in provider. Replaces the
// per-provider plugins (anthropic, openai, openrouter — all redundant since
// pi-ai already maintains an exhaustive registry).
//
// Each registered provider's createClient delegates to pi-ai's getModel.
// Custom baseUrl in credential.options.baseUrl is honored. For passthrough
// providers like OpenRouter that accept arbitrary `vendor/model-id`, models
// not in pi-ai's registry are synthesised with sensible defaults.

import {
  type Api,
  getModel as piGetModel,
  getModels as piGetModels,
  getProviders as piGetProviders,
  type Model,
} from "@mariozechner/pi-ai";

import {
  definePlugin,
  type ModelInfo,
  type ProviderCredential,
  type ResolvedRoleModel,
} from "@oddjob/sdk";

import { applyCustomBaseUrl, readCustomBaseUrl, toModelInfo } from "./convert.ts";

// Per-provider hint metadata for the dashboard credential form.
const PROVIDER_DISPLAY: Record<string, { displayName: string; authHint: string }> = {
  anthropic: {
    displayName: "Anthropic",
    authHint: "ANTHROPIC_API_KEY (optionally baseUrl for proxy).",
  },
  "amazon-bedrock": {
    displayName: "Amazon Bedrock",
    authHint: "AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY.",
  },
  "azure-openai-responses": {
    displayName: "Azure OpenAI",
    authHint: "AZURE_OPENAI_API_KEY + baseUrl.",
  },
  cerebras: { displayName: "Cerebras", authHint: "CEREBRAS_API_KEY." },
  deepseek: { displayName: "DeepSeek", authHint: "DEEPSEEK_API_KEY." },
  fireworks: { displayName: "Fireworks", authHint: "FIREWORKS_API_KEY." },
  "github-copilot": { displayName: "GitHub Copilot", authHint: "GITHUB_TOKEN." },
  google: { displayName: "Google AI", authHint: "GEMINI_API_KEY." },
  "google-antigravity": { displayName: "Google Antigravity", authHint: "GOOGLE_API_KEY." },
  "google-gemini-cli": { displayName: "Google Gemini CLI", authHint: "OAuth via gemini CLI." },
  "google-vertex": { displayName: "Google Vertex AI", authHint: "GOOGLE_APPLICATION_CREDENTIALS." },
  groq: { displayName: "Groq", authHint: "GROQ_API_KEY." },
  huggingface: { displayName: "HuggingFace", authHint: "HF_TOKEN." },
  "kimi-coding": { displayName: "Kimi", authHint: "KIMI_API_KEY." },
  minimax: { displayName: "MiniMax", authHint: "MINIMAX_API_KEY." },
  "minimax-cn": { displayName: "MiniMax (CN)", authHint: "MINIMAX_API_KEY." },
  mistral: { displayName: "Mistral", authHint: "MISTRAL_API_KEY." },
  openai: {
    displayName: "OpenAI",
    authHint: "OPENAI_API_KEY (optionally baseUrl for Azure / proxy).",
  },
  "openai-codex": { displayName: "OpenAI Codex", authHint: "OPENAI_API_KEY." },
  opencode: { displayName: "OpenCode", authHint: "OPENCODE_API_KEY." },
  "opencode-go": { displayName: "OpenCode Go", authHint: "OPENCODE_API_KEY." },
  openrouter: {
    displayName: "OpenRouter",
    authHint: "OPENROUTER_API_KEY (multi-vendor passthrough).",
  },
  "vercel-ai-gateway": { displayName: "Vercel AI Gateway", authHint: "AI_GATEWAY_API_KEY." },
  xai: { displayName: "X.AI (Grok)", authHint: "XAI_API_KEY." },
  zai: { displayName: "Z.AI", authHint: "ZAI_API_KEY." },
};

// Providers that accept arbitrary model ids (passthrough proxies). For these,
// createClient synthesises a Model when pi-ai's registry doesn't have the id.
const PASSTHROUGH_PROVIDERS: ReadonlySet<string> = new Set([
  "openrouter",
  "vercel-ai-gateway",
  "huggingface",
  "fireworks",
  "opencode",
  "opencode-go",
]);

function tryRegistry<TApi extends Api>(provider: string, modelId: string): Model<TApi> | undefined {
  try {
    return piGetModel(provider as never, modelId as never) as Model<TApi>;
  } catch {
    return undefined;
  }
}

/**
 * Synthesise a Model for a passthrough provider when pi-ai doesn't have the
 * exact id. Borrows api+baseUrl from another model in the same provider so
 * Anthropic-style passthroughs (Fireworks, Vercel) stay anthropic-messages
 * and OpenAI-style ones stay openai-completions.
 */
function synthesiseModel(provider: string, modelId: string, exemplar: Model<Api>): Model<Api> {
  return {
    id: modelId,
    name: `${modelId} (${provider})`,
    api: exemplar.api,
    provider,
    baseUrl: exemplar.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 16_384,
  };
}

export default definePlugin(
  {
    slug: "pi-models",
    name: "Pi-AI Models",
    description:
      "Registers a ModelProviderService for every pi-ai built-in provider (~25 providers, ~880 models).",
    version: "0.1.0",
    author: "Oddjob",
  },
  (b) => {
    const providers = piGetProviders();
    for (const provider of providers) {
      const meta = PROVIDER_DISPLAY[provider] ?? {
        displayName: provider,
        authHint: `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY.`,
      };
      const isPassthrough = PASSTHROUGH_PROVIDERS.has(provider);
      const piModels = piGetModels(provider as never) as Model<Api>[];
      const exemplar: Model<Api> | undefined = piModels[0];
      const models: readonly ModelInfo[] = piModels.map((m) => toModelInfo(m));
      b.modelProvider({
        id: provider,
        displayName: meta.displayName,
        authHint: meta.authHint,
        capabilities: { tools: true, streaming: true, vision: true, reasoning: true },
        listModels: () => models,
        createClient: (modelId: string, credential: ProviderCredential): ResolvedRoleModel => {
          const customBase = readCustomBaseUrl(credential.options, credential.baseUrl);
          // Always prefer pi-ai's registry entry (it carries the correct
          // api kind, default baseUrl, accurate context/cost). Then layer
          // a custom baseUrl on top if supplied.
          const registryModel = tryRegistry<Api>(provider, modelId);
          let model: Model<Api>;
          if (registryModel) {
            model = applyCustomBaseUrl(registryModel, customBase);
          } else if (isPassthrough && exemplar) {
            // Passthrough provider with an unknown id (e.g. OpenRouter
            // `acme/foo`) — synthesise using the provider's exemplar api +
            // baseUrl so Anthropic-style passthroughs stay anthropic-messages.
            model = applyCustomBaseUrl(synthesiseModel(provider, modelId, exemplar), customBase);
          } else {
            // Strict provider, unknown id — surface a useful error rather
            // than silently calling something we can't dispatch.
            throw new Error(
              `pi-models: provider '${provider}' has no model '${modelId}' in pi-ai's registry`,
            );
          }
          const info = models.find((mi) => mi.id === modelId);
          return { model, apiKey: credential.apiKey, info };
        },
      });
    }
  },
);
