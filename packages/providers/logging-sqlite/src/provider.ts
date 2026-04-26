import type { LogProvider } from "@oddjob/core";

export class LoggingSqliteProvider implements Partial<LogProvider> {
  readonly name = "logging-sqlite";

  async connect(): Promise<void> {
    throw new Error("logging-sqlite: not implemented");
  }

  async disconnect(): Promise<void> {
    return;
  }

  async healthy(): Promise<boolean> {
    return false;
  }
}
