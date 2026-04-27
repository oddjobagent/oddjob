import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { DockerEnvironmentProvider, type DockerSession } from "./provider.ts";

const isLive = process.env.ODDJOB_LIVE_DOCKER === "1";
const describeLive = isLive ? describe : describe.skip;

const TEST_IMAGE = process.env.ODDJOB_TEST_DOCKER_IMAGE ?? "debian:bookworm-slim";

describeLive("DockerEnvironmentProvider (live)", () => {
  let provider: DockerEnvironmentProvider;
  let session: DockerSession;

  beforeAll(async () => {
    provider = new DockerEnvironmentProvider();
    session = (await provider.spawn({
      config: { type: "cloud", image: TEST_IMAGE },
    })) as DockerSession;
  }, 120_000);

  afterAll(async () => {
    if (session) await session.kill();
  });

  test("exec captures stdout + exit code", async () => {
    const r = await session.exec("echo docker-hello");
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("docker-hello");
  }, 30_000);

  test("exec captures non-zero exit", async () => {
    const r = await session.exec("ls /definitely-not-real; exit 7");
    expect(r.exitCode).toBe(7);
  }, 30_000);

  test("writeFile + readFile round trip via host bind", async () => {
    await session.writeFile("hello.txt", "world");
    expect(await session.readFile("hello.txt")).toBe("world");
  }, 30_000);

  test("writeFile + readFile via docker exec for absolute paths", async () => {
    await session.writeFile("/tmp/oddjob-abs.txt", "abs-data");
    const back = await session.readFile("/tmp/oddjob-abs.txt");
    expect(back.trim()).toBe("abs-data");
  }, 30_000);

  test("kill removes the container", async () => {
    const p = new DockerEnvironmentProvider();
    const s = (await p.spawn({ config: { type: "cloud", image: TEST_IMAGE } })) as DockerSession;
    const r1 = await s.exec("echo alive");
    expect(r1.stdout.trim()).toBe("alive");
    await s.kill();
    // Subsequent exec on a destroyed session must throw.
    expect(s.exec("echo dead")).rejects.toThrow(/destroyed/);
  }, 60_000);
});
