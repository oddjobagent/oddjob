import type {
  AuthProvider,
  ChannelProvider,
  LogProvider,
  McpProvider,
  PluginRegistry,
  QueueProvider,
  RoleResolver,
  SchedulerProvider,
  SecretsProvider,
  StateProvider,
} from "@oddjob/core";
import type { EngineConfig } from "@oddjob/agent";
import type { LlmPiProvider } from "@oddjob/llm-pi";

export interface Runtime {
  state: StateProvider;
  queue: QueueProvider;
  secrets: SecretsProvider;
  log: LogProvider;
  llm: LlmPiProvider;
  mcp?: McpProvider;
  auth?: AuthProvider;
  scheduler?: SchedulerProvider;
  channelFor: (type: string) => ChannelProvider | undefined;
  bearerToken?: string;
  engine?: EngineConfig;
  plugins: PluginRegistry;
  /**
   * Resolves a model role -> (pi-ai Model, apiKey). Reads engine roles +
   * deployment overrides + provider credentials at call time so the
   * dashboard can hot-update assignments without a restart.
   */
  roleResolver: RoleResolver;
  /**
   * Reload engine roles + provider credentials from the StateProvider into
   * the in-memory RoleResolver. The PATCH /api/v1/engine handler calls this
   * after persisting changes.
   */
  reloadRoles?: () => Promise<void>;
  /**
   * CLI-provided persistence hook. When the dashboard hot-reloads the engine
   * config via PATCH /api/v1/engine, the server mutates `runtime.engine` in
   * place and then calls this hook so the change survives a restart.
   */
  persistEngine?: (engine: EngineConfig | undefined) => Promise<void>;
  /**
   * Re-serialize the full engine config (plugins/providers/roles) from current
   * DB state to ~/.oddjob/config.toml. Called by API mutations that change
   * config-classified rows. CLI wires this up; tests can leave it undefined.
   */
  persistConfig?: () => Promise<void>;
  /**
   * Re-read ~/.oddjob/config.toml and run reconciliation against the DB. Used
   * by `oddjob config reload` / `POST /api/v1/config/reload`.
   */
  reloadConfig?: () => Promise<void>;
  config: {
    host: string;
    port: number;
    maxWorkers: number;
    leaseMs: number;
    heartbeatMs: number;
    pollMs: number;
  };
}

export const DEFAULT_CONFIG: Runtime["config"] = {
  host: "127.0.0.1",
  port: 7777,
  maxWorkers: 3,
  leaseMs: 60_000,
  heartbeatMs: 15_000,
  pollMs: 1000,
};
