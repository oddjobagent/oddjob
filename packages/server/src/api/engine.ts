import {
  BUILTIN_TOOL_NAMES,
  listAllModels,
  listProviders,
  type BuiltinToolsConfig,
  type EngineConfig,
  type ModelDescriptor,
} from "@oddjob/agent";

import type { Runtime } from "../runtime.ts";
import { type Handler, badRequest, json, readJson } from "../middleware/index.ts";

interface BuiltinToolDescriptor {
  name: string;
  description: string;
  category: "filesystem" | "shell" | "network" | "execution" | "utility";
  configurable: boolean;
}

const TOOL_CATALOG: Record<string, Omit<BuiltinToolDescriptor, "name">> = {
  bash: {
    description: "Execute shell commands in the run sandbox.",
    category: "shell",
    configurable: false,
  },
  read: {
    description: "Read a file from the sandbox.",
    category: "filesystem",
    configurable: false,
  },
  write: {
    description: "Write a file in the sandbox.",
    category: "filesystem",
    configurable: false,
  },
  edit: {
    description: "Edit an existing file in the sandbox.",
    category: "filesystem",
    configurable: false,
  },
  grep: {
    description: "Search file contents with regex.",
    category: "filesystem",
    configurable: false,
  },
  find: { description: "Find files by glob pattern.", category: "filesystem", configurable: false },
  ls: { description: "List directory contents.", category: "filesystem", configurable: false },
  web_fetch: {
    description: "Fetch a URL and return the body as markdown (HTML→md conversion). SSRF guarded.",
    category: "network",
    configurable: true,
  },
  web_search: {
    description: "Run a web search via Brave / Tavily / SearXNG. Requires provider config.",
    category: "network",
    configurable: true,
  },
  python_repl: {
    description: "Execute Python via system python3 (configurable timeout).",
    category: "execution",
    configurable: true,
  },
  javascript_repl: {
    description: "Execute JavaScript/TypeScript via bun -e (configurable timeout).",
    category: "execution",
    configurable: true,
  },
  datetime: {
    description: "Get the current date/time in arbitrary timezones.",
    category: "utility",
    configurable: false,
  },
};

export const tools = (): Handler => () => {
  const list: BuiltinToolDescriptor[] = BUILTIN_TOOL_NAMES.map((name) => ({
    name,
    ...(TOOL_CATALOG[name] ?? {
      description: name,
      category: "utility" as const,
      configurable: false,
    }),
  }));
  return json({ tools: list });
};

export const get =
  (rt: Runtime): Handler =>
  async () => {
    const masked = redactEngine(rt.engine);
    const defaultEnvironmentId = await rt.state.getEngineSetting<string>("default_environment_id");
    const body: Record<string, unknown> = {
      engine: masked,
      restartRequired: {
        host: rt.config.host,
        port: rt.config.port,
        bearerTokenRequired: !!rt.bearerToken,
        maxWorkers: rt.config.maxWorkers,
      },
    };
    if (defaultEnvironmentId) body.defaultEnvironmentId = defaultEnvironmentId;
    return json(body);
  };

interface EnginePatchBody {
  builtinTools?: BuiltinToolsConfig;
  /** Engine-level default environment id. Persisted to engine_settings. */
  defaultEnvironmentId?: string | null;
}

export const update =
  (rt: Runtime): Handler =>
  async (req) => {
    const body = await readJson<EnginePatchBody>(req);
    if (!body) return badRequest("body required");
    const merged: EngineConfig = mergeEngine(rt.engine, body);
    rt.engine = merged;
    if (rt.persistEngine) {
      try {
        await rt.persistEngine(merged);
      } catch (err) {
        return badRequest(`persisted engine failed: ${(err as Error).message}`);
      }
    }
    if ("defaultEnvironmentId" in body) {
      if (body.defaultEnvironmentId === null || body.defaultEnvironmentId === "") {
        await rt.state.deleteEngineSetting("default_environment_id");
      } else if (typeof body.defaultEnvironmentId === "string") {
        const env = await rt.state.getEnvironment(body.defaultEnvironmentId);
        if (!env) return badRequest(`environment '${body.defaultEnvironmentId}' not found`);
        await rt.state.setEngineSetting("default_environment_id", body.defaultEnvironmentId);
      }
    }
    return json({
      engine: redactEngine(merged),
      reloaded: changedKeys(body),
      restartRequired: [],
    });
  };

// Maps provider slug → secret name the user must configure to use this provider.
// (Sourced from pi-ai's auth conventions; covers all providers in pi-ai's registry.)
const PROVIDER_SECRET: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  "google-vertex": "GOOGLE_APPLICATION_CREDENTIALS",
  "google-gemini-cli": "",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  bedrock: "AWS_ACCESS_KEY_ID",
  deepseek: "DEEPSEEK_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  xai: "XAI_API_KEY",
  kimi: "KIMI_API_KEY",
  vercel: "AI_GATEWAY_API_KEY",
  "github-copilot": "GITHUB_TOKEN",
  huggingface: "HF_TOKEN",
  fireworks: "FIREWORKS_API_KEY",
  faux: "",
};

export const models =
  (rt: Runtime): Handler =>
  async () => {
    const secretNames = new Set(await rt.secrets.list());
    const all = listAllModels();
    const out = all.map((m: ModelDescriptor) => {
      const requiresSecret = PROVIDER_SECRET[m.provider] ?? "";
      return {
        id: m.id,
        modelId: m.modelId,
        provider: m.provider,
        displayName: m.displayName,
        api: m.api,
        reasoning: m.reasoning,
        input: m.input,
        cost: m.cost,
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
        requiresSecret,
        available: requiresSecret === "" || secretNames.has(requiresSecret),
      };
    });
    return json({ models: out, providers: listProviders() });
  };

function mergeEngine(current: EngineConfig | undefined, patch: EnginePatchBody): EngineConfig {
  const cur = current ?? {};
  const builtin: BuiltinToolsConfig = { ...cur.builtinTools };
  if (patch.builtinTools) {
    if (patch.builtinTools.webSearch !== undefined)
      builtin.webSearch = patch.builtinTools.webSearch;
    if (patch.builtinTools.webFetch !== undefined) builtin.webFetch = patch.builtinTools.webFetch;
    if (patch.builtinTools.pythonRepl !== undefined)
      builtin.pythonRepl = patch.builtinTools.pythonRepl;
    if (patch.builtinTools.javascriptRepl !== undefined)
      builtin.javascriptRepl = patch.builtinTools.javascriptRepl;
  }
  return { ...cur, builtinTools: builtin };
}

function changedKeys(patch: EnginePatchBody): string[] {
  if (!patch.builtinTools) return [];
  return Object.keys(patch.builtinTools).map((k) => `builtinTools.${k}`);
}

function redactEngine(e: EngineConfig | undefined): EngineConfig | undefined {
  if (!e) return undefined;
  const bt = e.builtinTools;
  if (!bt) return e;
  const out: BuiltinToolsConfig = { ...bt };
  if (bt.webSearch) {
    out.webSearch = { ...bt.webSearch, apiKey: bt.webSearch.apiKey ? "***" : undefined };
  }
  return { ...e, builtinTools: out };
}
