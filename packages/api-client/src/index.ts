import type {
  Blueprint,
  BuiltinToolsConfig,
  ChannelConfig,
  Deployment,
  EngineConfig,
  LogEntry,
  Run,
  RunFilter,
} from "@oddjob/core";

import { createTransport, type Transport, type TransportOptions } from "./transport.ts";

export { ApiError, createTransport, type Transport, type TransportOptions } from "./transport.ts";

export interface DeploymentListOptions {
  includeArchived?: boolean;
}

export interface ModelOption {
  id: string;
  provider: string;
  requiresSecret: string;
  available: boolean;
}

export interface ChannelTypeFieldDescriptor {
  name: string;
  label: string;
  kind: "string" | "secretRef" | "stringList" | "headers";
  required: boolean;
  helper?: string;
}

export interface ChannelTypeDescriptor {
  type: string;
  label: string;
  description: string;
  fields: ChannelTypeFieldDescriptor[];
}

export interface BuiltinToolDescriptor {
  name: string;
  description: string;
  category: string;
  configurable: boolean;
}

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
    push: (input: { toml?: string; path?: string; blueprint?: Blueprint }) => Promise<Blueprint>;
    remove: (id: string) => Promise<void>;
  };

  deployments: {
    list: (opts?: DeploymentListOptions) => Promise<{ deployments: Deployment[] }>;
    get: (id: string) => Promise<Deployment>;
    create: (input: unknown) => Promise<Deployment>;
    update: (id: string, patch: unknown) => Promise<Deployment>;
    remove: (id: string) => Promise<void>;
    trigger: (id: string, input?: unknown) => Promise<{ run_id: string }>;
    pause: (id: string) => Promise<Deployment>;
    resume: (id: string) => Promise<Deployment>;
    archive: (id: string) => Promise<Deployment>;
    unarchive: (id: string) => Promise<Deployment>;
    nextRun: (id: string) => Promise<{ deploymentId: string; nextRun: number | null }>;
  };

  runs: {
    list: (f?: RunFilter) => Promise<{ runs: Run[] }>;
    get: (id: string) => Promise<Run>;
    logs: (id: string, since?: number, limit?: number) => Promise<{ entries: LogEntry[] }>;
    cancel: (id: string) => Promise<{ runId: string; result: string }>;
  };

  secrets: {
    list: () => Promise<{ secrets: string[] }>;
    set: (name: string, value: string) => Promise<void>;
    remove: (name: string) => Promise<void>;
  };

  engine: {
    get: () => Promise<{
      engine?: EngineConfig;
      restartRequired: { host: string; port: number; bearerTokenRequired: boolean; maxWorkers: number };
    }>;
    update: (patch: { builtinTools?: BuiltinToolsConfig }) => Promise<{
      engine?: EngineConfig;
      reloaded: string[];
      restartRequired: string[];
    }>;
    tools: () => Promise<{ tools: BuiltinToolDescriptor[] }>;
  };

  models: {
    list: () => Promise<{ models: ModelOption[] }>;
  };

  channels: {
    types: () => Promise<{ types: ChannelTypeDescriptor[] }>;
    test: (
      config: ChannelConfig,
      message?: string,
    ) => Promise<{ ok: boolean; sentAt?: string }>;
    listTemplates: () => Promise<{
      templates: Array<{
        name: string;
        type: string;
        config: ChannelConfig;
        description?: string;
        createdAt: number;
        updatedAt: number;
      }>;
    }>;
    upsertTemplate: (input: {
      name: string;
      config: ChannelConfig;
      description?: string;
    }) => Promise<{
      template: {
        name: string;
        type: string;
        config: ChannelConfig;
        description?: string;
        createdAt: number;
        updatedAt: number;
      };
    }>;
    deleteTemplate: (name: string) => Promise<void>;
  };

  cron: {
    preview: (
      schedule: string,
      timezone?: string,
      count?: number,
    ) => Promise<{ schedule: string; timezone?: string; nextRuns: number[] }>;
  };

  auth: {
    list: () => Promise<{
      tokens: Array<{
        connectorId: string;
        deploymentId: string;
        connectorName: string;
        status: string;
        expiresAt?: number;
        scopes?: string;
        updatedAt: number;
      }>;
    }>;
    status: (
      connectorId: string,
    ) => Promise<{ connectorId: string; status: string }>;
    initiate: (
      deploymentId: string,
      connectorName: string,
    ) => Promise<{
      connectorId: string;
      status: string;
      redirectUrl?: string;
      message?: string;
    }>;
    revoke: (connectorId: string) => Promise<void>;
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
      push: (input) => r("POST", "/api/v1/blueprints", input),
      remove: (id) => r("DELETE", `/api/v1/blueprints/${id}`),
    },

    deployments: {
      list: (opts = {}) => {
        const q = new URLSearchParams();
        if (opts.includeArchived) q.set("include_archived", "1");
        const qs = q.toString();
        return r("GET", `/api/v1/deployments${qs ? `?${qs}` : ""}`);
      },
      get: (id) => r("GET", `/api/v1/deployments/${id}`),
      create: (input) => r("POST", "/api/v1/deployments", input),
      update: (id, patch) => r("PATCH", `/api/v1/deployments/${id}`, patch),
      remove: (id) => r("DELETE", `/api/v1/deployments/${id}`),
      trigger: (id, input) => r("POST", `/api/v1/deployments/${id}/run`, { input }),
      pause: (id) => r("POST", `/api/v1/deployments/${id}/pause`),
      resume: (id) => r("POST", `/api/v1/deployments/${id}/resume`),
      archive: (id) => r("POST", `/api/v1/deployments/${id}/archive`),
      unarchive: (id) => r("POST", `/api/v1/deployments/${id}/unarchive`),
      nextRun: (id) => r("GET", `/api/v1/deployments/${id}/next-run`),
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
      cancel: (id) => r("POST", `/api/v1/runs/${id}/cancel`),
    },

    secrets: {
      list: () => r("GET", "/api/v1/secrets"),
      set: (name, value) => r("PUT", `/api/v1/secrets/${name}`, { value }),
      remove: (name) => r("DELETE", `/api/v1/secrets/${name}`),
    },

    engine: {
      get: () => r("GET", "/api/v1/engine"),
      update: (patch) => r("PATCH", "/api/v1/engine", patch),
      tools: () => r("GET", "/api/v1/engine/tools"),
    },

    models: {
      list: () => r("GET", "/api/v1/models"),
    },

    channels: {
      types: () => r("GET", "/api/v1/channels/types"),
      test: (config, message) => r("POST", "/api/v1/channels/test", { config, message }),
      listTemplates: () => r("GET", "/api/v1/channel-templates"),
      upsertTemplate: (input) => r("POST", "/api/v1/channel-templates", input),
      deleteTemplate: (name) => r("DELETE", `/api/v1/channel-templates/${name}`),
    },

    cron: {
      preview: (schedule, timezone, count) =>
        r("POST", "/api/v1/cron/preview", { schedule, timezone, count }),
    },

    auth: {
      list: () => r("GET", "/api/v1/auth/connectors"),
      status: (connectorId) => r("GET", `/api/v1/auth/connectors/${connectorId}`),
      initiate: (deploymentId, connectorName) =>
        r("POST", "/api/v1/auth/connectors/initiate", { deploymentId, connectorName }),
      revoke: (connectorId) => r("DELETE", `/api/v1/auth/connectors/${connectorId}`),
    },
  };
}
