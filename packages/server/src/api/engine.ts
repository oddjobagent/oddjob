import { BUILTIN_TOOL_NAMES, type BuiltinToolsConfig, type EngineConfig } from "@oddjob/core";

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
  () => {
    const masked = redactEngine(rt.engine);
    return json({
      engine: masked,
      restartRequired: {
        host: rt.config.host,
        port: rt.config.port,
        bearerTokenRequired: !!rt.bearerToken,
        maxWorkers: rt.config.maxWorkers,
      },
    });
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

export const models =
  (rt: Runtime): Handler =>
  async () => {
    // Models aren't enumerable from pi-ai's public API at runtime without
    // pulling in the registry directly, so we surface a curated, conservative
    // list keyed off which secrets the user has configured. Dashboard's
    // combobox lets the user fall back to free-text for anything else.
    const secretNames = new Set(await rt.secrets.list());

    const candidates: Array<{ id: string; provider: string; requiresSecret: string }> = [
      // Anthropic
      { id: "anthropic/claude-opus-4", provider: "anthropic", requiresSecret: "ANTHROPIC_API_KEY" },
      {
        id: "anthropic/claude-sonnet-4",
        provider: "anthropic",
        requiresSecret: "ANTHROPIC_API_KEY",
      },
      {
        id: "anthropic/claude-haiku-4-5",
        provider: "anthropic",
        requiresSecret: "ANTHROPIC_API_KEY",
      },
      // OpenAI
      { id: "openai/gpt-4o", provider: "openai", requiresSecret: "OPENAI_API_KEY" },
      { id: "openai/gpt-4o-mini", provider: "openai", requiresSecret: "OPENAI_API_KEY" },
      // Google
      { id: "google/gemini-2.5-flash", provider: "google", requiresSecret: "GOOGLE_API_KEY" },
      { id: "google/gemini-2.5-pro", provider: "google", requiresSecret: "GOOGLE_API_KEY" },
      // OpenRouter — works with any vendor through one key
      {
        id: "openrouter/anthropic/claude-sonnet-4",
        provider: "openrouter",
        requiresSecret: "OPENROUTER_API_KEY",
      },
      {
        id: "openrouter/openai/gpt-4o",
        provider: "openrouter",
        requiresSecret: "OPENROUTER_API_KEY",
      },
      // Test
      { id: "faux/test", provider: "faux", requiresSecret: "" },
    ];

    const out = candidates.map((c) => ({
      ...c,
      available: c.requiresSecret === "" || secretNames.has(c.requiresSecret),
    }));
    return json({ models: out });
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
