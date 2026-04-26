import type { StateProvider } from "@oddjob/core";

export class StateSqliteProvider implements Partial<StateProvider> {
  readonly name = "state-sqlite";

  async connect(): Promise<void> {
    throw new Error("state-sqlite: not implemented");
  }

  async disconnect(): Promise<void> {
    return;
  }

  async healthy(): Promise<boolean> {
    return false;
  }
}
