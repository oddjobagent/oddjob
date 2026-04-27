import { describe, expect, test } from "bun:test";

import { isOnPath } from "./available.ts";
import { buildBwrapArgs, BwrapEnvironmentProvider } from "./bwrap.ts";

const isLinux = process.platform === "linux";
let bwrapAvailable = false;
if (isLinux) bwrapAvailable = await isOnPath("bwrap");
const describeBwrap = isLinux && bwrapAvailable ? describe : describe.skip;

describe("buildBwrapArgs", () => {
  test("includes --unshare-all + --share-net + writable workdir bind + meta bind", () => {
    const a = buildBwrapArgs("/tmp/wd", "/tmp/meta");
    expect(a).toContain("--unshare-all");
    expect(a).toContain("--share-net");
    expect(a).toContain("--die-with-parent");
    // Writable bind for workdir + meta.
    const i = a.indexOf("--bind");
    expect(a.slice(i, i + 3)).toEqual(["--bind", "/tmp/wd", "/tmp/wd"]);
    const j = a.lastIndexOf("--bind");
    expect(a.slice(j, j + 3)).toEqual(["--bind", "/tmp/meta", "/tmp/meta"]);
  });

  test("uses ro-bind-try for /lib64 (absent on 32-bit)", () => {
    const a = buildBwrapArgs("/tmp/wd", "/tmp/meta");
    const idx = a.indexOf("/lib64");
    expect(a[idx - 1]).toBe("--ro-bind-try");
  });

  test("does NOT bind a writable /tmp host hole", () => {
    const a = buildBwrapArgs("/tmp/wd", "/tmp/meta");
    // /tmp must be a tmpfs, not a host bind.
    const tmpfsIdx = a.indexOf("--tmpfs");
    expect(tmpfsIdx).toBeGreaterThan(-1);
    expect(a[tmpfsIdx + 1]).toBe("/tmp");
    // No --bind /tmp /tmp anywhere.
    for (let k = 0; k < a.length - 2; k++) {
      if (a[k] === "--bind" && a[k + 1] === "/tmp" && a[k + 2] === "/tmp") {
        throw new Error("found writable host /tmp bind");
      }
    }
  });
});

describeBwrap("BwrapEnvironmentProvider (Linux)", () => {
  test("exec captures stdout under bwrap", async () => {
    const sb = new BwrapEnvironmentProvider();
    const session = await sb.spawn({});
    const r = await session.exec("echo from-bwrap");
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("from-bwrap");
    await session.kill();
  });

  test("writeFile + readFile inside workdir", async () => {
    const sb = new BwrapEnvironmentProvider();
    const session = await sb.spawn({});
    await session.writeFile("a.txt", "b");
    expect(await session.readFile("a.txt")).toBe("b");
    await session.kill();
  });

  test("writeFile to absolute path outside workdir is rejected (FS policy)", async () => {
    const sb = new BwrapEnvironmentProvider();
    const session = await sb.spawn({});
    await expect(session.writeFile("/etc/oddjob-pwn", "boom")).rejects.toThrow(/refusing path outside/);
    await session.kill();
  });

  test("can list /usr (ro-bind) but cannot write to it", async () => {
    const sb = new BwrapEnvironmentProvider();
    const session = await sb.spawn({});
    const r = await session.exec("ls /usr/bin/sh 2>&1; touch /usr/oddjob-test 2>&1; echo exit=$?");
    expect(r.stdout).toContain("/usr/bin/sh");
    expect(r.stdout).toMatch(/Read-only|Permission denied|exit=1/);
    await session.kill();
  });

  test("egress proxy env vars are wired when egressProxy set", async () => {
    const prev = process.env.NO_PROXY;
    process.env.NO_PROXY = "localhost,*.internal";
    const PEM = "-----BEGIN CERTIFICATE-----\nMIIB-fake-pem-bytes\n-----END CERTIFICATE-----\n";
    try {
      const sb = new BwrapEnvironmentProvider();
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

  test("rejects workdir = '/'", async () => {
    const sb = new BwrapEnvironmentProvider();
    await expect(sb.spawn({ workdir: "/" })).rejects.toThrow(/workdir/);
  });
});
