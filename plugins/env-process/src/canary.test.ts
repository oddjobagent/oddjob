import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { ProcessEnvironmentProvider } from "./provider.ts";

const LEAK_KEY = "ODDJOB_LEAK_TEST";
const LEAK_VAL = "secret-do-not-leak";

describe("ProcessEnvironmentProvider", () => {
  beforeAll(() => {
    process.env[LEAK_KEY] = LEAK_VAL;
  });
  afterAll(() => {
    delete process.env[LEAK_KEY];
  });

  test("exec captures stdout + exitCode", async () => {
    const sb = new ProcessEnvironmentProvider();
    const session = await sb.spawn({});
    const r = await session.exec("echo hello");
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("hello");
    await session.kill();
  });

  test("exec captures non-zero exit + stderr", async () => {
    const sb = new ProcessEnvironmentProvider();
    const session = await sb.spawn({});
    const r = await session.exec("ls /definitely-does-not-exist-oddjob 2>&1; exit 7");
    expect(r.exitCode).toBe(7);
    expect(r.stdout.length).toBeGreaterThan(0);
    await session.kill();
  });

  test("exec accepts stdin", async () => {
    const sb = new ProcessEnvironmentProvider();
    const session = await sb.spawn({});
    const r = await session.exec("cat", { stdin: "piped data" });
    expect(r.stdout).toBe("piped data");
    await session.kill();
  });

  test("writeFile + readFile round trip", async () => {
    const sb = new ProcessEnvironmentProvider();
    const session = await sb.spawn({});
    await session.writeFile("hello.txt", "world");
    expect(await session.readFile("hello.txt")).toBe("world");
    await session.kill();
  });

  test("env is injected from EnvironmentRunConfig.env", async () => {
    const sb = new ProcessEnvironmentProvider();
    const session = await sb.spawn({ env: { ODDJOB_TEST: "ZZ" } });
    const r = await session.exec("echo $ODDJOB_TEST");
    expect(r.stdout.trim()).toBe("ZZ");
    await session.kill();
  });

  test("host env is curated: ODDJOB_LEAK_TEST does NOT reach the spawned shell", async () => {
    expect(process.env[LEAK_KEY]).toBe(LEAK_VAL);
    const sb = new ProcessEnvironmentProvider();
    const session = await sb.spawn({});
    const r = await session.exec(`printenv ${LEAK_KEY}; echo done; printenv | wc -l`);
    expect(r.stdout).toContain("done");
    expect(r.stdout).not.toContain(LEAK_VAL);
    // Sanity: PATH/HOME/USER should still be there (allowlisted).
    const pr = await session.exec("printenv PATH | head -c 1; echo");
    expect(pr.exitCode).toBe(0);
    expect(pr.stdout.length).toBeGreaterThan(1);
    await session.kill();
  });

  test("egress proxy env vars are wired when egressProxy set", async () => {
    // Seed a host NO_PROXY so we can assert it gets cleared in the spawned shell.
    const prev = process.env.NO_PROXY;
    process.env.NO_PROXY = "localhost,*.internal";
    const PEM = "-----BEGIN CERTIFICATE-----\nMIIB-fake-pem-bytes\n-----END CERTIFICATE-----\n";
    try {
      const sb = new ProcessEnvironmentProvider();
      const session = await sb.spawn({
        egressProxy: { url: "http://oddjob:t0k@127.0.0.1:8888", caPem: PEM },
      });
      const cmd = [
        "echo HTTPS_PROXY=$HTTPS_PROXY",
        "echo HTTP_PROXY=$HTTP_PROXY",
        "echo https_proxy=$https_proxy",
        "echo http_proxy=$http_proxy",
        "echo NODE_USE_ENV_PROXY=$NODE_USE_ENV_PROXY",
        "echo CA_PATH=$NODE_EXTRA_CA_CERTS",
        "cat $NODE_EXTRA_CA_CERTS",
        "echo NO_PROXY=[$NO_PROXY]",
        "echo no_proxy=[$no_proxy]",
      ].join("; ");
      const r = await session.exec(cmd);
      expect(r.stdout).toContain("HTTPS_PROXY=http://oddjob:t0k@127.0.0.1:8888");
      expect(r.stdout).toContain("http_proxy=http://oddjob:t0k@127.0.0.1:8888");
      expect(r.stdout).toContain("NODE_USE_ENV_PROXY=1");
      // NODE_EXTRA_CA_CERTS must be a real file path the proxy CA was written to.
      expect(r.stdout).toMatch(/CA_PATH=[^\s]+\/oddjob-ca\.pem/);
      // The PEM contents must be readable from that path.
      expect(r.stdout).toContain("BEGIN CERTIFICATE");
      expect(r.stdout).toContain("NO_PROXY=[]");
      expect(r.stdout).toContain("no_proxy=[]");
      await session.kill();
    } finally {
      if (prev === undefined) delete process.env.NO_PROXY;
      else process.env.NO_PROXY = prev;
    }
  });

  test("egress proxy with empty caPem (v1 stub) does not set NODE_EXTRA_CA_CERTS", async () => {
    const sb = new ProcessEnvironmentProvider();
    const session = await sb.spawn({
      egressProxy: { url: "http://oddjob:t0k@127.0.0.1:8888", caPem: "" },
    });
    const r = await session.exec(
      "echo HTTPS_PROXY=$HTTPS_PROXY; echo CA_PATH=[$NODE_EXTRA_CA_CERTS]",
    );
    expect(r.stdout).toContain("HTTPS_PROXY=http://oddjob:t0k@127.0.0.1:8888");
    expect(r.stdout).toContain("CA_PATH=[]");
    await session.kill();
  });

  test("session.signal aborts in-flight exec", async () => {
    const ac = new AbortController();
    const sb = new ProcessEnvironmentProvider();
    const session = await sb.spawn({ signal: ac.signal });
    // "exec sleep 30" replaces sh with sleep so SIGKILL hits sleep directly.
    const slow = session.exec("exec sleep 30");
    setTimeout(() => ac.abort(), 50);
    const r = await slow;
    expect(r.exitCode).not.toBe(0);
    expect(r.durationMs).toBeLessThan(3000);
    await session.kill();
  }, 10_000);

  test("per-call signal aborts in-flight exec", async () => {
    const ac = new AbortController();
    const sb = new ProcessEnvironmentProvider();
    const session = await sb.spawn({});
    const slow = session.exec("exec sleep 30", { signal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    const r = await slow;
    expect(r.exitCode).not.toBe(0);
    expect(r.durationMs).toBeLessThan(3000);
    await session.kill();
  }, 10_000);

  test("default export is a definePlugin module that registers env-process", async () => {
    const mod = await import("./index.ts");
    const plugin = mod.default;
    expect(plugin.manifest.slug).toBe("env-process");
    expect(plugin.services).toHaveLength(1);
    const svc = plugin.services[0]!;
    expect(svc.kind).toBe("environment");
    if (svc.kind !== "environment") throw new Error("unreachable");
    expect(svc.id).toBe("process");
    expect(svc.trustTier).toBe("trusted");
    const live = await svc.available();
    expect(live.ok).toBe(true);
    const provider = svc.create();
    expect(provider).toBeDefined();
  });
});
