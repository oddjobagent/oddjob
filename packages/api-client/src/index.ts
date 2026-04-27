import type {
  Blueprint,
  BuiltinToolsConfig,
  ChannelConfig,
  Deployment,
  EngineConfig,
  Environment,
  EnvironmentInput,
  LogEntry,
  ModelInfo,
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
    get: (id: string, ref?: { tag?: string; version?: string }) => Promise<Blueprint>;
    push: (input: {
      toml?: string;
      path?: string;
      blueprint?: Blueprint;
      promoteTags?: string[];
      force?: boolean;
    }) => Promise<Blueprint>;
    remove: (id: string) => Promise<void>;
    listVersions: (id: string) => Promise<{
      versions: Array<{
        blueprintId: string;
        version: string;
        description: string;
        contentHash: string;
        createdAt: number;
      }>;
    }>;
    listTags: (id: string) => Promise<{
      tags: Array<{ blueprintId: string; tag: string; version: string; updatedAt: number }>;
    }>;
    setTag: (
      id: string,
      tag: string,
      version: string,
    ) => Promise<{ id: string; tag: string; version: string }>;
    removeTag: (id: string, tag: string) => Promise<void>;
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
      restartRequired: {
        host: string;
        port: number;
        bearerTokenRequired: boolean;
        maxWorkers: number;
      };
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

  environments: {
    list: () => Promise<{ environments: Environment[] }>;
    get: (id: string) => Promise<Environment>;
    upsert: (input: { toml?: string; environment?: EnvironmentInput }) => Promise<Environment>;
    remove: (id: string) => Promise<void>;
  };

  channels: {
    types: () => Promise<{ types: ChannelTypeDescriptor[] }>;
    test: (config: ChannelConfig, message?: string) => Promise<{ ok: boolean; sentAt?: string }>;
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
    status: (connectorId: string) => Promise<{ connectorId: string; status: string }>;
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

  plugins: {
    list: () => Promise<{ plugins: PluginSummary[] }>;
    get: (slug: string) => Promise<PluginDetail>;
    setEnabled: (slug: string, enabled: boolean) => Promise<{ slug: string; enabled: boolean }>;
  };

  providers: {
    list: () => Promise<{ providers: ProviderSummary[] }>;
    get: (slug: string) => Promise<ProviderDetail>;
    refresh: (slug: string) => Promise<{ slug: string; count: number; fetchedAt: number }>;
    upsertCredential: (
      slug: string,
      input: CredentialUpsert,
    ) => Promise<{ slug: string; credentialName: string; ok: true }>;
    deleteCredential: (
      slug: string,
      credentialName: string,
    ) => Promise<{ slug: string; credentialName: string; ok: true }>;
  };

  roles: {
    list: () => Promise<{ roles: RoleAssignmentSummary[] }>;
    set: (role: string, input: RoleSetInput) => Promise<{ role: string; ok: true }>;
    remove: (role: string) => Promise<{ role: string; ok: true }>;
  };

  config: {
    get: () => Promise<ResolvedConfig>;
    reload: () => Promise<{ ok: true }>;
  };
}

export interface ResolvedConfig {
  providers: Array<{
    providerSlug: string;
    credentialName: string;
    apiKeySecret?: string;
    hasOptions: boolean;
    source: "config" | "dashboard";
    updatedAt: number;
  }>;
  roles: Array<{
    role: string;
    providerSlug: string;
    modelId: string;
    credentialName: string;
    source: "config" | "dashboard";
    updatedAt: number;
  }>;
  plugins: Array<{
    slug: string;
    version: string;
    source: "bundled" | "local" | "npm";
    enabled: boolean;
  }>;
  hooks: { persistConfig: boolean; reloadConfig: boolean };
}

export interface PluginSummary {
  slug: string;
  name: string;
  description: string;
  version: string;
  source: "bundled" | "local" | "npm";
  enabled: boolean;
  icon?: string;
  homepage?: string;
  author?: string;
  services: Array<{ kind: string; id?: string; type?: string; name?: string }>;
}

export interface PluginDetail {
  slug: string;
  manifest: { slug: string; name: string; description: string; version: string };
  record: { source: string; enabled: boolean; installedAt: number };
  services: unknown[];
}

export interface ProviderSummary {
  slug: string;
  displayName: string;
  authHint?: string;
  capabilities: { tools: boolean; streaming: boolean; vision: boolean; reasoning: boolean };
  models: number;
  hasRefresh: boolean;
  hasCredentials: boolean;
}

export interface ProviderDetail {
  slug: string;
  displayName: string;
  authHint?: string;
  capabilities: { tools: boolean; streaming: boolean; vision: boolean; reasoning: boolean };
  models: ModelInfo[];
  credentials: Array<{
    credentialName: string;
    apiKeySecret?: string;
    hasOptions: boolean;
    source: "config" | "dashboard";
    updatedAt: number;
  }>;
}

export interface CredentialUpsert {
  credentialName?: string;
  apiKey?: string;
  apiKeySecret?: string;
  options?: Record<string, unknown>;
}

export interface RoleAssignmentSummary {
  role: string;
  providerSlug: string;
  modelId: string;
  credentialName: string;
  source: "config" | "dashboard";
  updatedAt: number;
}

export interface RoleSetInput {
  providerSlug: string;
  modelId: string;
  credentialName?: string;
  options?: Record<string, unknown>;
}

export function createApi(opts: TransportOptions): OddjobApi {
  const r: Transport = createTransport(opts);

  return {
    health: () => r("GET", "/api/v1/health"),
    status: () => r("GET", "/api/v1/status"),

    blueprints: {
      list: () => r("GET", "/api/v1/blueprints"),
      get: (id, ref) => {
        const q = new URLSearchParams();
        if (ref?.version) q.set("version", ref.version);
        else if (ref?.tag) q.set("tag", ref.tag);
        const qs = q.toString();
        return r("GET", `/api/v1/blueprints/${id}${qs ? `?${qs}` : ""}`);
      },
      push: (input) => {
        const q = new URLSearchParams();
        if (input.force) q.set("force", "1");
        const qs = q.toString();
        return r("POST", `/api/v1/blueprints${qs ? `?${qs}` : ""}`, input);
      },
      remove: (id) => r("DELETE", `/api/v1/blueprints/${id}`),
      listVersions: (id) => r("GET", `/api/v1/blueprints/${id}/versions`),
      listTags: (id) => r("GET", `/api/v1/blueprints/${id}/tags`),
      setTag: (id, tag, version) => r("PUT", `/api/v1/blueprints/${id}/tags/${tag}`, { version }),
      removeTag: (id, tag) => r("DELETE", `/api/v1/blueprints/${id}/tags/${tag}`),
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

    environments: {
      list: () => r("GET", "/api/v1/environments"),
      get: (id) => r("GET", `/api/v1/environments/${id}`),
      upsert: (input) => r("POST", "/api/v1/environments", input),
      remove: (id) => r("DELETE", `/api/v1/environments/${id}`),
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

    plugins: {
      list: () => r("GET", "/api/v1/plugins"),
      get: (slug) => r("GET", `/api/v1/plugins/${slug}`),
      setEnabled: (slug, enabled) => r("PATCH", `/api/v1/plugins/${slug}`, { enabled }),
    },

    providers: {
      list: () => r("GET", "/api/v1/providers"),
      get: (slug) => r("GET", `/api/v1/providers/${slug}`),
      refresh: (slug) => r("POST", `/api/v1/providers/${slug}/refresh`),
      upsertCredential: (slug, input) => r("PUT", `/api/v1/providers/${slug}/credentials`, input),
      deleteCredential: (slug, credentialName) =>
        r("DELETE", `/api/v1/providers/${slug}/credentials/${credentialName}`),
    },

    roles: {
      list: () => r("GET", "/api/v1/roles"),
      set: (role, input) => r("PUT", `/api/v1/roles/${role}`, input),
      remove: (role) => r("DELETE", `/api/v1/roles/${role}`),
    },

    config: {
      get: () => r("GET", "/api/v1/config"),
      reload: () => r("POST", "/api/v1/config/reload"),
    },
  };
}
