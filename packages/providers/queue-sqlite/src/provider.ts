import type { QueueProvider } from "@oddjob/core";

export class QueueSqliteProvider implements Partial<QueueProvider> {
  readonly name = "queue-sqlite";

  async connect(): Promise<void> {
    throw new Error("queue-sqlite: not implemented");
  }

  async disconnect(): Promise<void> {
    return;
  }

  async healthy(): Promise<boolean> {
    return false;
  }
}
