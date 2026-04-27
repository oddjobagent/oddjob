import { type OddjobApi, createApi } from "@oddjob/api-client";

import { loadConfig, serverUrl } from "./config.ts";

export { ApiError } from "@oddjob/api-client";
export type { OddjobApi } from "@oddjob/api-client";

let cached: OddjobApi | null = null;
let cachedKey = "";

async function getApi(): Promise<OddjobApi> {
  const cfg = await loadConfig();
  const baseUrl = serverUrl(cfg);
  const bearerToken = cfg.server.bearer_token;
  const key = `${baseUrl}|${bearerToken ?? ""}`;
  if (cached && cachedKey === key) return cached;
  cached = createApi({ baseUrl, bearerToken });
  cachedKey = key;
  return cached;
}

// Lazy proxy: every property access resolves the api on demand.
// Keeps the original `import { api } from "../lib/api.ts"; api.runs.list()` shape working.
type Methods = OddjobApi;
function proxy<K extends keyof Methods>(key: K): Methods[K] {
  return new Proxy(
    {},
    {
      get(_t, prop: string) {
        return async (...args: unknown[]) => {
          const a = await getApi();
          const ns = a[key] as Record<
            string,
            ((...args: unknown[]) => Promise<unknown>) | undefined
          >;
          const fn = ns[prop];
          if (typeof fn !== "function") throw new Error(`api.${String(key)}.${prop} not found`);
          return fn(...args);
        };
      },
    },
  ) as Methods[K];
}

export const api: OddjobApi = {
  health: async () => (await getApi()).health(),
  status: async () => (await getApi()).status(),
  blueprints: proxy("blueprints"),
  deployments: proxy("deployments"),
  runs: proxy("runs"),
  secrets: proxy("secrets"),
  environments: proxy("environments"),
  engine: proxy("engine"),
  models: proxy("models"),
  channels: proxy("channels"),
  cron: proxy("cron"),
  auth: proxy("auth"),
  plugins: proxy("plugins"),
  providers: proxy("providers"),
  roles: proxy("roles"),
  config: proxy("config"),
};

/**
 * Raw fetch helper for routes the typed OddjobApi client doesn't cover yet.
 * Uses the configured base URL + bearer token automatically.
 */
export async function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const cfg = await loadConfig();
  const baseUrl = serverUrl(cfg);
  const headers = new Headers(init?.headers);
  if (cfg.server.bearer_token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${cfg.server.bearer_token}`);
  }
  return fetch(new URL(path, baseUrl), { ...init, headers });
}
