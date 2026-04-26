import type { QueueProvider } from "@oddjob/core";

export class QueueMemoryProvider implements Partial<QueueProvider> {
  readonly name = "queue-memory";

  async connect(): Promise<void> {
    throw new Error("queue-memory: not implemented");
  }

  async disconnect(): Promise<void> {
    return;
  }

  async healthy(): Promise<boolean> {
    return false;
  }
}
