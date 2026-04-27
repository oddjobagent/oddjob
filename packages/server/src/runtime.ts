import type {
  AuthProvider,
  ChannelProvider,
  EngineConfig,
  LogProvider,
  McpProvider,
  QueueProvider,
  SandboxProvider,
  SchedulerProvider,
  SecretsProvider,
  StateProvider,
} from "@oddjob/core";
import type { LlmPiProvider } from "@oddjob/llm-pi";

export interface Runtime {
  state: StateProvider;
  queue: QueueProvider;
  secrets: SecretsProvider;
  log: LogProvider;
  sandbox: SandboxProvider;
  llm: LlmPiProvider;
  mcp?: McpProvider;
  auth?: AuthProvider;
  scheduler?: SchedulerProvider;
  channelFor: (type: string) => ChannelProvider | undefined;
  bearerToken?: string;
  engine?: EngineConfig;
  /**
   * CLI-provided persistence hook. When the dashboard hot-reloads the engine
   * config via PATCH /api/v1/engine, the server mutates `runtime.engine` in
   * place and then calls this hook so the change survives a restart.
   */
  persistEngine?: (engine: EngineConfig | undefined) => Promise<void>;
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
