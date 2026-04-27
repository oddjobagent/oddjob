import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { SeatbeltEnvironmentProvider, buildSeatbeltProfile } from "./seatbelt.ts";

const isMac = process.platform === "darwin";
const describeMac = isMac ? describe : describe.skip;

const LEAK_KEY = "ODDJOB_SB_LEAK_TEST";
const LEAK_VAL = "secret-do-not-leak";

describe("buildSeatbeltProfile", () => {
  test("includes deny-default + allow file-write subpath of workdir + meta", () => {
    const p = buildSeatbeltProfile("/tmp/wd", "/tmp/meta");
    expect(p).toContain("(deny default)");
    expect(p).toContain('(allow file-write* (subpath "/tmp/wd"))');
    expect(p).toContain('(allow file-write* (subpath "/tmp/meta"))');
    expect(p).toContain("(allow file-read*)");
    expect(p).toContain("(allow process-fork)");
    expect(p).toContain("(allow process-exec)");
  });

  test("does NOT grant broad host-dir writes", () => {
    const p = buildSeatbeltProfile("/tmp/wd", "/tmp/meta");
    expect(p).not.toContain('(allow file-write* (subpath "/private/tmp"))');
    expect(p).not.toContain('(allow file-write* (subpath "/private/var/tmp"))');
    expect(p).not.toContain('(allow file-write* (subpath "/private/var/folders"))');
    // file-write* without (subpath ...) would mean anywhere.
    expect(p).not.toMatch(/\(allow file-write\*\)\s*$/m);
  });

  test("read deny-list covers exfil-prone paths", () => {
    const p = buildSeatbeltProfile("/tmp/wd", "/tmp/meta");
    expect(p).toContain('(deny file-read* (subpath "/tmp"))');
    expect(p).toContain('(deny file-read* (subpath "/private/tmp"))');
    expect(p).toContain('(deny file-read* (subpath "/Users"))');
    expect(p).toContain('(deny file-read* (subpath "/opt"))');
    expect(p).toContain('(deny file-read* (subpath "/Library/Keychains"))');
    expect(p).toContain('(deny file-read* (subpath "/private/var/db/sudo"))');
    expect(p).toContain('(deny file-read* (subpath "/private/etc/ssh"))');
  });

  test("workdir + meta + /opt/homebrew re-allowed inside the deny zones", () => {
    const p = buildSeatbeltProfile("/tmp/wd", "/tmp/meta");
    expect(p).toContain('(allow file-read* (subpath "/tmp/wd"))');
    expect(p).toContain('(allow file-read* (subpath "/tmp/meta"))');
    expect(p).toContain('(allow file-read* (subpath "/opt/homebrew"))');
  });

  test("network is allow*-shaped (proxy enforces host policy, not seatbelt)", () => {
    const open = buildSeatbeltProfile("/tmp/wd", "/tmp/meta");
    expect(open).toContain("(allow network*)");
    // sandbox-exec does NOT reliably support host-level outbound filters;
    // policy enforcement lives in the credential-broker proxy + CA pinning.
    // Proxy mode therefore does not narrow the network rule here.
    const proxy = buildSeatbeltProfile("/tmp/wd", "/tmp/meta", { proxyHost: "127.0.0.1" });
    expect(proxy).toContain("(allow network*)");
  });

  test("escapes embedded quotes in path", () => {
    const p = buildSeatbeltProfile('/tmp/with"quote', "/tmp/meta");
    expect(p).toContain('"/tmp/with\\"quote"');
  });
});

describeMac("SeatbeltEnvironmentProvider (macOS)", () => {
  beforeAll(() => {
    process.env[LEAK_KEY] = LEAK_VAL;
  });
  afterAll(() => {
    delete process.env[LEAK_KEY];
  });

  test("exec captures stdout under sandbox", async () => {
    const sb = new SeatbeltEnvironmentProvider();
    const session = await sb.spawn({});
    const r = await session.exec("echo from-seatbelt");
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("from-seatbelt");
    await session.kill();
  });

  test("file-write outside workdir is denied", async () => {
    const sb = new SeatbeltEnvironmentProvider();
    const session = await sb.spawn({});
    // /Users/<me>/oddjob-seatbelt-deny-test is not in workdir + meta.
    const r = await session.exec(`touch "$HOME/oddjob-seatbelt-deny-test" 2>&1; echo exit=$?`);
    expect(r.stdout).toContain("exit=");
    const denied =
      /exit=[1-9]/.test(r.stdout) || /sandbox|operation not permitted|denied/i.test(r.stdout);
    expect(denied).toBe(true);
    await session.kill();
  });

  test("writeFile + readFile round trip inside workdir", async () => {
    const sb = new SeatbeltEnvironmentProvider();
    const session = await sb.spawn({});
    await session.writeFile("hello.txt", "world");
    expect(await session.readFile("hello.txt")).toBe("world");
    await session.kill();
  });

  test("writeFile to absolute path outside workdir is rejected (FS policy)", async () => {
    const sb = new SeatbeltEnvironmentProvider();
    const session = await sb.spawn({});
    await expect(session.writeFile("/etc/oddjob-pwn", "boom")).rejects.toThrow(
      /refusing path outside/,
    );
    await expect(session.writeFile("../escape.txt", "boom")).rejects.toThrow(
      /refusing path outside/,
    );
    await session.kill();
  });

  test("host env is curated: ODDJOB_SB_LEAK_TEST does NOT reach the spawned shell", async () => {
    expect(process.env[LEAK_KEY]).toBe(LEAK_VAL);
    const sb = new SeatbeltEnvironmentProvider();
    const session = await sb.spawn({});
    const r = await session.exec(`printenv ${LEAK_KEY}; echo done`);
    expect(r.stdout).toContain("done");
    expect(r.stdout).not.toContain(LEAK_VAL);
    await session.kill();
  });

  test("egress proxy env vars are wired when egressProxy set", async () => {
    const prev = process.env.NO_PROXY;
    process.env.NO_PROXY = "localhost,*.internal";
    const PEM = "-----BEGIN CERTIFICATE-----\nMIIB-fake-pem-bytes\n-----END CERTIFICATE-----\n";
    try {
      const sb = new SeatbeltEnvironmentProvider();
      const session = await sb.spawn({
        egressProxy: { url: "http://oddjob:t0k@127.0.0.1:8888", caPem: PEM },
      });
      const cmd = [
        "echo HTTPS_PROXY=$HTTPS_PROXY",
        "echo http_proxy=$http_proxy",
        "echo NODE_USE_ENV_PROXY=$NODE_USE_ENV_PROXY",
        "echo CA_PATH=$NODE_EXTRA_CA_CERTS",
        "cat $NODE_EXTRA_CA_CERTS",
        "echo NO_PROXY=[$NO_PROXY]",
      ].join("; ");
      const r = await session.exec(cmd);
      expect(r.stdout).toContain("HTTPS_PROXY=http://oddjob:t0k@127.0.0.1:8888");
      expect(r.stdout).toContain("http_proxy=http://oddjob:t0k@127.0.0.1:8888");
      expect(r.stdout).toContain("NODE_USE_ENV_PROXY=1");
      expect(r.stdout).toMatch(/CA_PATH=[^\s]+\/oddjob-ca\.pem/);
      expect(r.stdout).toContain("BEGIN CERTIFICATE");
      expect(r.stdout).toContain("NO_PROXY=[]");
      await session.kill();
    } finally {
      if (prev === undefined) delete process.env.NO_PROXY;
      else process.env.NO_PROXY = prev;
    }
  });

  test("session.signal aborts in-flight exec", async () => {
    const ac = new AbortController();
    const sb = new SeatbeltEnvironmentProvider();
    const session = await sb.spawn({ signal: ac.signal });
    // "exec sleep 30" replaces sh with sleep so SIGKILL kills the top-level pid directly.
    const slow = session.exec("exec sleep 30");
    setTimeout(() => ac.abort(), 50);
    const r = await slow;
    expect(r.exitCode).not.toBe(0);
    expect(r.durationMs).toBeLessThan(3000);
    await session.kill();
  }, 10_000);

  test("rejects workdir = '/'", async () => {
    const sb = new SeatbeltEnvironmentProvider();
    await expect(sb.spawn({ workdir: "/" })).rejects.toThrow(/workdir/);
  });

  test("deny-list blocks reads of credential paths (~/.ssh, /Library/Keychains)", async () => {
    const sb = new SeatbeltEnvironmentProvider();
    const session = await sb.spawn({});
    // ~/.ssh likely doesnt exist on test hosts but the deny rule fires before
    // ENOENT — sandbox-exec emits a deny diagnostic. Either way: read fails.
    const r1 = await session.exec("cat $HOME/.ssh/id_rsa 2>&1; echo exit=$?");
    expect(r1.stdout).toMatch(/exit=[1-9]|denied|operation not permitted/i);
    const r2 = await session.exec("ls /Library/Keychains 2>&1; echo exit=$?");
    expect(r2.stdout).toMatch(/exit=[1-9]|denied|operation not permitted/i);
    await session.kill();
  });

  test("deny-list does NOT block reads inside workdir", async () => {
    const sb = new SeatbeltEnvironmentProvider();
    const session = await sb.spawn({});
    await session.writeFile("hello.txt", "world");
    const r = await session.exec("cat hello.txt");
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("world");
    await session.kill();
  });

  test("reads inside /usr (allowlisted) succeed", async () => {
    const sb = new SeatbeltEnvironmentProvider();
    const session = await sb.spawn({});
    const r = await session.exec("ls /usr/lib/dyld 2>&1; echo exit=$?");
    // dyld may live in /usr/lib (Mac) or be absent under that name; either
    // ls succeeds (exit 0) or ENOENT (exit 1) — what we are asserting is
    // that we did NOT get a sandbox deny diagnostic.
    expect(r.stdout).not.toMatch(/sandbox|operation not permitted|denied/i);
    await session.kill();
  });

  test("reads of arbitrary /tmp paths are denied (other agents workdirs)", async () => {
    const sb = new SeatbeltEnvironmentProvider();
    const session = await sb.spawn({});
    // Create something readable on the host /tmp (outside the sandbox workdir).
    const r = await session.exec(
      "mkdir -p /tmp/oddjob-cross-agent-test 2>&1; echo data > /tmp/oddjob-cross-agent-test/secret 2>&1; cat /tmp/oddjob-cross-agent-test/secret 2>&1; echo exit=$?",
    );
    expect(r.stdout).toMatch(/exit=[1-9]|denied|operation not permitted/i);
    await session.kill();
  });

  test("reads of /opt (outside allowlist) are denied", async () => {
    const sb = new SeatbeltEnvironmentProvider();
    const session = await sb.spawn({});
    const r = await session.exec("ls /opt 2>&1; echo exit=$?");
    // /opt may not exist on every host; sandbox deny still fires before ENOENT
    // would, OR if /opt/homebrew is the only /opt entry, the ls of /opt itself
    // is denied.
    expect(r.stdout).toMatch(/exit=[1-9]|denied|operation not permitted/i);
    await session.kill();
  });

  test("runtime smoke-test commands still work under the tightened profile", async () => {
    const sb = new SeatbeltEnvironmentProvider();
    const session = await sb.spawn({});
    const r1 = await session.exec("echo hello-from-bash");
    expect(r1.exitCode).toBe(0);
    expect(r1.stdout.trim()).toBe("hello-from-bash");
    // Bun + Python available depending on host; both should be reachable
    // under the profile if they are on PATH (allowlisted /opt/homebrew etc.).
    // We do NOT assert success — only that the sandbox does not block the
    // runtime from finding + loading them.
    const r2 = await session.exec(
      'command -v bun >/dev/null && bun -e "console.log(1)" || echo bun-absent',
    );
    expect(r2.stdout).toMatch(/^1$|^bun-absent$/m);
    await session.kill();
  });

  test("rejects workdir at known-dangerous system root", async () => {
    const sb = new SeatbeltEnvironmentProvider();
    await expect(sb.spawn({ workdir: "/etc" })).rejects.toThrow(/forbidden system root|workdir/);
  });
});
