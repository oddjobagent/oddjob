import { describe, expect, test } from "bun:test";

import { SchedulerCronerProvider } from "./provider.ts";

describe("SchedulerCronerProvider", () => {
  test("schedule + listScheduled + unschedule", async () => {
    const s = new SchedulerCronerProvider();
    await s.connect();

    let fired = 0;
    await s.schedule("d1", "* * * * * *", undefined, async () => {
      fired++;
    });

    const list = await s.listScheduled();
    expect(list.length).toBe(1);
    expect(list[0]?.deploymentId).toBe("d1");
    expect(list[0]?.nextRun).toBeInstanceOf(Date);

    await new Promise((r) => setTimeout(r, 1500));
    expect(fired).toBeGreaterThanOrEqual(1);

    await s.unschedule("d1");
    const list2 = await s.listScheduled();
    expect(list2.length).toBe(0);
    await s.disconnect();
  });

  test("rescheduling replaces previous job", async () => {
    const s = new SchedulerCronerProvider();
    await s.schedule("d2", "0 9 * * *", undefined, async () => {});
    await s.schedule("d2", "0 17 * * *", undefined, async () => {});
    const list = await s.listScheduled();
    expect(list.length).toBe(1);
    await s.disconnect();
  });
});
