import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { DaytonaEnvironmentProvider, type DaytonaEnvironmentSession } from "./provider.ts";

const isLive = process.env.ODDJOB_LIVE_DAYTONA === "1" && !!process.env.DAYTONA_API_KEY;
const describeLive = isLive ? describe : describe.skip;

describeLive("DaytonaEnvironmentProvider (live)", () => {
  let provider: DaytonaEnvironmentProvider;
  let session: DaytonaEnvironmentSession;

  beforeAll(async () => {
    provider = new DaytonaEnvironmentProvider({ apiKey: process.env.DAYTONA_API_KEY! });
    session = (await provider.spawn({ config: { type: "cloud" } })) as DaytonaEnvironmentSession;
  }, 120_000);

  afterAll(async () => {
    if (session) await session.kill();
  });

  test("exec captures stdout + exit code", async () => {
    const r = await session.exec("echo daytona-hello");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("daytona-hello");
  }, 60_000);

  test("exec captures non-zero exit", async () => {
    const r = await session.exec("ls /definitely-not-a-real-path-xyzzy; exit 7");
    expect(r.exitCode).toBe(7);
  }, 60_000);

  test("writeFile + readFile round trip", async () => {
    await session.writeFile("/tmp/oddjob-rt.txt", "hello-from-test");
    const back = await session.readFile("/tmp/oddjob-rt.txt");
    expect(back.trim()).toBe("hello-from-test");
  }, 60_000);

  test("exposePort returns a preview URL", async () => {
    if (!session.exposePort) throw new Error("exposePort capability missing");
    const r = await session.exposePort(8080);
    expect(r.url.length).toBeGreaterThan(0);
    expect(r.url).toMatch(/^https?:\/\//);
  }, 60_000);

  test("snapshot creates a named snapshot (best-effort, _experimental_ in SDK)", async () => {
    if (!session.snapshot) throw new Error("snapshot capability missing");
    try {
      const r = await session.snapshot(`oddjob-test-${Date.now()}`);
      expect(r.id.length).toBeGreaterThan(0);
    } catch (err) {
      // _experimental_ — surface SDK error so we know what changed.
      console.warn("snapshot failed (SDK _experimental_):", (err as Error).message);
    }
  }, 120_000);
});
