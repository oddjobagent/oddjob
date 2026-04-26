import type { Blueprint, Deployment, Run, RunFilter } from "@oddjob/core";

import { loadConfig, serverUrl } from "./config.ts";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const cfg = await loadConfig();
  const url = `${serverUrl(cfg)}${path}`;
  const headers: Record<string, string> = {};
  if (cfg.server.bearer_token) headers.authorization = `Bearer ${cfg.server.bearer_token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const resp = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new ApiError(resp.status, `${method} ${path} -> ${resp.status} ${text}`);
  }
  if (resp.status === 204) return undefined as T;
  const ct = resp.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await resp.json()) as T;
  return (await resp.text()) as unknown as T;
}

export const api = {
  health: () => request<{ ok: boolean }>("GET", "/api/v1/health"),
  status: () => request<Record<string, unknown>>("GET", "/api/v1/status"),

  blueprints: {
    list: () => request<{ blueprints: Blueprint[] }>("GET", "/api/v1/blueprints"),
    get: (id: string) => request<Blueprint>("GET", `/api/v1/blueprints/${id}`),
    push: (toml: string, path?: string) =>
      request<Blueprint>("POST", "/api/v1/blueprints", { toml, path }),
    remove: (id: string) => request<void>("DELETE", `/api/v1/blueprints/${id}`),
  },

  deployments: {
    list: () => request<{ deployments: Deployment[] }>("GET", "/api/v1/deployments"),
    get: (id: string) => request<Deployment>("GET", `/api/v1/deployments/${id}`),
    create: (input: unknown) => request<Deployment>("POST", "/api/v1/deployments", input),
    update: (id: string, patch: unknown) =>
      request<Deployment>("PATCH", `/api/v1/deployments/${id}`, patch),
    remove: (id: string) => request<void>("DELETE", `/api/v1/deployments/${id}`),
    trigger: (id: string, input?: unknown) =>
      request<{ run_id: string }>("POST", `/api/v1/deployments/${id}/run`, { input }),
  },

  runs: {
    list: (f: RunFilter = {}) => {
      const q = new URLSearchParams();
      if (f.deploymentId) q.set("deployment_id", f.deploymentId);
      if (f.limit) q.set("limit", String(f.limit));
      const qs = q.toString();
      return request<{ runs: Run[] }>("GET", `/api/v1/runs${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) => request<Run>("GET", `/api/v1/runs/${id}`),
    logs: (id: string, since?: number) => {
      const qs = since ? `?since=${since}` : "";
      return request<{ entries: Array<Record<string, unknown>> }>(
        "GET",
        `/api/v1/runs/${id}/logs${qs}`,
      );
    },
  },

  secrets: {
    list: () => request<{ secrets: string[] }>("GET", "/api/v1/secrets"),
    set: (name: string, value: string) =>
      request<void>("PUT", `/api/v1/secrets/${name}`, { value }),
    remove: (name: string) => request<void>("DELETE", `/api/v1/secrets/${name}`),
  },
};
