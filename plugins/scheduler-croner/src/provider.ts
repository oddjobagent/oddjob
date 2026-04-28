import { Cron } from "croner";

import type { ScheduleHandler, ScheduledEntry, SchedulerProvider } from "@oddjob/core";

interface Slot {
  cron: string;
  timezone?: string;
  job: Cron;
}

export class SchedulerCronerProvider implements SchedulerProvider {
  readonly name = "scheduler-croner";
  private slots = new Map<string, Slot>();

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {
    for (const slot of this.slots.values()) slot.job.stop();
    this.slots.clear();
  }

  async healthy(): Promise<boolean> {
    return true;
  }

  async schedule(
    deploymentId: string,
    cron: string,
    timezone: string | undefined,
    handler: ScheduleHandler,
  ): Promise<void> {
    if (this.slots.has(deploymentId)) {
      this.slots.get(deploymentId)!.job.stop();
    }
    const job = new Cron(cron, { timezone, protect: true }, () => {
      void handler();
    });
    this.slots.set(deploymentId, { cron, timezone, job });
  }

  async unschedule(deploymentId: string): Promise<void> {
    const slot = this.slots.get(deploymentId);
    if (!slot) return;
    slot.job.stop();
    this.slots.delete(deploymentId);
  }

  async listScheduled(): Promise<ScheduledEntry[]> {
    const out: ScheduledEntry[] = [];
    for (const [deploymentId, slot] of this.slots) {
      out.push({
        deploymentId,
        cron: slot.cron,
        timezone: slot.timezone,
        nextRun: slot.job.nextRun(),
      });
    }
    return out;
  }

  async nextRun(deploymentId: string): Promise<Date | null> {
    const slot = this.slots.get(deploymentId);
    if (!slot) return null;
    return slot.job.nextRun();
  }
}
