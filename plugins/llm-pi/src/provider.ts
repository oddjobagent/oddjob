import { type Api, getModel as piGetModel, type Model } from "@mariozechner/pi-ai";

import type { SecretsProvider } from "@oddjob/core";

export interface LlmPiOptions {
  secrets?: SecretsProvider;
  /**
   * Test-only override: map a `model` string (e.g. `"faux/echo"`) to a fully
   * configured pi-ai Model. resolveModel checks this map first. Production
   * callers don't set this.
   */
  modelOverrides?: Map<string, Model<Api>>;
}

export interface ResolvedModel {
  model: Model<Api>;
  apiKey?: string;
  apiKeyEnv?: string;
}

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export class LlmPiProvider {
  readonly name = "llm-pi";
  private readonly secrets?: SecretsProvider;
  private readonly modelOverrides?: Map<string, Model<Api>>;

  constructor(options: LlmPiOptions = {}) {
    this.secrets = options.secrets;
    this.modelOverrides = options.modelOverrides;
  }

  /** Test helper: register a model under a string id post-construction. */
  registerModelOverride(modelString: string, model: Model<Api>): void {
    if (!this.modelOverrides) {
      throw new Error("modelOverrides map not configured");
    }
    this.modelOverrides.set(modelString, model);
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthy(): Promise<boolean> {
    return true;
  }

  /**
   * Parse a blueprint model string and return a configured pi-ai Model + key.
   *
   * Supported formats:
   *   "<provider>/<model-id>"             e.g. "anthropic/claude-sonnet-4"
   *   "openrouter/<vendor>/<model-id>"    e.g. "openrouter/anthropic/claude-sonnet-4"
   *   "faux/<id>"                         test-only, no key required
   */
  async resolveModel(modelString: string, secretRef?: string): Promise<ResolvedModel> {
    const override = this.modelOverrides?.get(modelString);
    if (override) return { model: override };

    const parts = modelString.split("/");
    const provider = parts[0];
    if (!provider) throw new Error(`invalid model string: ${modelString}`);

    if (provider === "faux") {
      const fauxId = parts.slice(1).join("/") || "faux-default";
      // Prefer the registered faux model (has the right `api: "faux"`) so
      // streamSimple routes through the faux provider rather than openai-completions.
      try {
        const registered = piGetModel("faux" as Parameters<typeof piGetModel>[0], fauxId as never);
        if (registered) return { model: registered };
      } catch {
        // Not registered (no test setup) - fall back to a stub model.
      }
      return { model: makeFauxModel(fauxId) };
    }

    if (provider === "openrouter") {
      const remainder = parts.slice(1).join("/");
      if (!remainder) throw new Error(`openrouter model id missing in: ${modelString}`);
      const apiKey = await this.lookupKey(secretRef, "OPENROUTER_API_KEY");
      const fromRegistry = tryRegistry("openrouter", remainder);
      return {
        model: fromRegistry ?? makeOpenRouterModel(remainder),
        apiKey,
        apiKeyEnv: "OPENROUTER_API_KEY",
      };
    }

    const knownModelId = parts.slice(1).join("/");
    if (!knownModelId) throw new Error(`model id missing in: ${modelString}`);
    const known = piGetModel(provider as Parameters<typeof piGetModel>[0], knownModelId as never);
    const envName = defaultEnvFor(provider);
    const apiKey = await this.lookupKey(secretRef, envName);
    return { model: known, apiKey, apiKeyEnv: envName };
  }

  private async lookupKey(
    secretRef: string | undefined,
    fallbackEnv: string,
  ): Promise<string | undefined> {
    if (secretRef && this.secrets) {
      const v = await this.secrets.get(secretRef);
      if (v) return v;
    }
    return process.env[fallbackEnv];
  }
}

function tryRegistry(provider: string, modelId: string): Model<Api> | undefined {
  try {
    return piGetModel(provider as Parameters<typeof piGetModel>[0], modelId as never) as Model<Api>;
  } catch {
    return undefined;
  }
}

function makeOpenRouterModel(modelId: string): Model<"openai-completions"> {
  return {
    id: modelId,
    name: `${modelId} (OpenRouter)`,
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: OPENROUTER_BASE,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8192,
  };
}

function makeFauxModel(id: string): Model<"openai-completions"> {
  return {
    id,
    name: `Faux ${id}`,
    api: "openai-completions",
    provider: "faux",
    baseUrl: "http://faux",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 1024,
  };
}

function defaultEnvFor(provider: string): string {
  switch (provider) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "google":
      return "GOOGLE_API_KEY";
    case "mistral":
      return "MISTRAL_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    default:
      return `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
  }
}
