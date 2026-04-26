import { describe, expect, test } from "bun:test";

import { SandboxProcessProvider } from "./provider.ts";

describe("SandboxProcessProvider", () => {
  test("exec captures stdout + exitCode", async () => {
    const sb = new SandboxProcessProvider();
    const session = await sb.spawn({});
    const r = await session.exec("echo hello");
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("hello");
    await session.kill();
  });

  test("exec captures non-zero exit + stderr", async () => {
    const sb = new SandboxProcessProvider();
    const session = await sb.spawn({});
    const r = await session.exec("ls /definitely-does-not-exist-oddjob 2>&1; exit 7");
    expect(r.exitCode).toBe(7);
    expect(r.stdout.length).toBeGreaterThan(0);
    await session.kill();
  });

  test("exec accepts stdin", async () => {
    const sb = new SandboxProcessProvider();
    const session = await sb.spawn({});
    const r = await session.exec("cat", { stdin: "piped data" });
    expect(r.stdout).toBe("piped data");
    await session.kill();
  });

  test("writeFile + readFile round trip", async () => {
    const sb = new SandboxProcessProvider();
    const session = await sb.spawn({});
    await session.writeFile("hello.txt", "world");
    expect(await session.readFile("hello.txt")).toBe("world");
    await session.kill();
  });

  test("env is injected", async () => {
    const sb = new SandboxProcessProvider();
    const session = await sb.spawn({ env: { ODDJOB_TEST: "ZZ" } });
    const r = await session.exec("echo $ODDJOB_TEST");
    expect(r.stdout.trim()).toBe("ZZ");
    await session.kill();
  });
});
