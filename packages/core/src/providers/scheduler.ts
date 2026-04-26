import type { Provider } from "./base.ts";

export interface SchedulerProvider extends Provider {
  schedule(
    deploymentId: string,
    cron: string,
    timezone: string | undefined,
    handler: ScheduleHandler,
  ): Promise<void>;
  unschedule(deploymentId: string): Promise<void>;
  listScheduled(): Promise<ScheduledEntry[]>;
  nextRun(deploymentId: string): Promise<Date | null>;
}

export type ScheduleHandler = () => Promise<void>;

export interface ScheduledEntry {
  deploymentId: string;
  cron: string;
  timezone?: string;
  nextRun: Date | null;
}
