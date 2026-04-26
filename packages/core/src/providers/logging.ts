import type { Provider } from "./base.ts";

export interface LogProvider extends Provider {
  log(runId: string, entry: LogEntry): Promise<void>;
  getLogs(runId: string, options?: LogQuery): Promise<LogEntry[]>;
  streamLogs?(runId: string): AsyncIterable<LogEntry>;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
}

export interface LogQuery {
  level?: LogLevel;
  since?: number;
  limit?: number;
}
