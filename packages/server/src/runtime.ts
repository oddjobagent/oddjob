import type {
  ChannelProvider,
  LogProvider,
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
  scheduler?: SchedulerProvider;
  channelFor: (type: string) => ChannelProvider | undefined;
  bearerToken?: string;
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
