import type { SchedulerProvider } from "@oddjob/core";

export class SchedulerCronerProvider implements Partial<SchedulerProvider> {
  readonly name = "scheduler-croner";

  async connect(): Promise<void> {
    throw new Error("scheduler-croner: not implemented");
  }

  async disconnect(): Promise<void> {
    return;
  }

  async healthy(): Promise<boolean> {
    return false;
  }
}
