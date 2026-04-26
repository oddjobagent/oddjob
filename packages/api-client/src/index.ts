import type { Blueprint, Deployment, LogEntry, Run, RunFilter } from "@oddjob/core";

import { createTransport, type Transport, type TransportOptions } from "./transport.ts";

export { ApiError, createTransport, type Transport, type TransportOptions } from "./transport.ts";

export interface OddjobApi {
  health: () => Promise<{
    ok: boolean;
    providers?: Record<string, boolean>;
    depth?: unknown;
    time?: number;
  }>;
  status: () => Promise<Record<string, unknown>>;

  blueprints: {
    list: () => Promise<{ blueprints: Blueprint[] }>;
    get: (id: string) => Promise<Blueprint>;
    push: (toml: string, path?: string) => Promise<Blueprint>;
    remove: (id: string) => Promise<void>;
  };

  deployments: {
    list: () => Promise<{ deployments: Deployment[] }>;
    get: (id: string) => Promise<Deployment>;
    create: (input: unknown) => Promise<Deployment>;
    update: (id: string, patch: unknown) => Promise<Deployment>;
    remove: (id: string) => Promise<void>;
    trigger: (id: string, input?: unknown) => Promise<{ run_id: string }>;
  };

  runs: {
    list: (f?: RunFilter) => Promise<{ runs: Run[] }>;
    get: (id: string) => Promise<Run>;
    logs: (id: string, since?: number, limit?: number) => Promise<{ entries: LogEntry[] }>;
  };

  secrets: {
    list: () => Promise<{ secrets: string[] }>;
    set: (name: string, value: string) => Promise<void>;
    remove: (name: string) => Promise<void>;
  };
}

export function createApi(opts: TransportOptions): OddjobApi {
  const r: Transport = createTransport(opts);

  return {
    health: () => r("GET", "/api/v1/health"),
    status: () => r("GET", "/api/v1/status"),

    blueprints: {
      list: () => r("GET", "/api/v1/blueprints"),
      get: (id) => r("GET", `/api/v1/blueprints/${id}`),
      push: (toml, path) => r("POST", "/api/v1/blueprints", { toml, path }),
      remove: (id) => r("DELETE", `/api/v1/blueprints/${id}`),
    },

    deployments: {
      list: () => r("GET", "/api/v1/deployments"),
      get: (id) => r("GET", `/api/v1/deployments/${id}`),
      create: (input) => r("POST", "/api/v1/deployments", input),
      update: (id, patch) => r("PATCH", `/api/v1/deployments/${id}`, patch),
      remove: (id) => r("DELETE", `/api/v1/deployments/${id}`),
      trigger: (id, input) => r("POST", `/api/v1/deployments/${id}/run`, { input }),
    },

    runs: {
      list: (f = {}) => {
        const q = new URLSearchParams();
        if (f.deploymentId) q.set("deployment_id", f.deploymentId);
        if (f.status) q.set("status", f.status);
        if (f.limit) q.set("limit", String(f.limit));
        const qs = q.toString();
        return r("GET", `/api/v1/runs${qs ? `?${qs}` : ""}`);
      },
      get: (id) => r("GET", `/api/v1/runs/${id}`),
      logs: (id, since, limit) => {
        const q = new URLSearchParams();
        if (since) q.set("since", String(since));
        if (limit) q.set("limit", String(limit));
        const qs = q.toString();
        return r("GET", `/api/v1/runs/${id}/logs${qs ? `?${qs}` : ""}`);
      },
    },

    secrets: {
      list: () => r("GET", "/api/v1/secrets"),
      set: (name, value) => r("PUT", `/api/v1/secrets/${name}`, { value }),
      remove: (name) => r("DELETE", `/api/v1/secrets/${name}`),
    },
  };
}
