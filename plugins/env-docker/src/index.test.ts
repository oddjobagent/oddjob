import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import plugin from "./index.ts";
import {
  DockerEnvironmentProvider,
  type RunDockerArgs,
  type RunDockerResult,
} from "./provider.ts";

describe("env-docker plugin (unit)", () => {
  test("manifest slug + service shape", () => {
    expect(plugin.manifest.slug).toBe("env-docker");
    expect(plugin.services).toHaveLength(1);
    const svc = plugin.services[0]!;
    expect(svc.kind).toBe("environment");
    if (svc.kind !== "environment") throw new Error("unreachable");
    expect(svc.id).toBe("docker");
    expect(svc.trustTier).toBe("container");
    expect(svc.capabilities.pauseResume).toBe(true);
    expect(svc.capabilities.snapshot).toBe(false);
    expect(svc.capabilities.fork).toBe(false);
    expect(svc.capabilities.packageManagers).toEqual(["apt", "pip", "npm"]);
  });

  test("create() returns a provider", () => {
    const svc = plugin.services[0]!;
    if (svc.kind !== "environment") throw new Error("unreachable");
    const provider = svc.create();
    expect(provider.name).toBe("env-docker");
  });
});

describe("DockerEnvironmentProvider workdir semantics (unit, stubbed runDocker)", () => {
  function makeStub(): {
    calls: RunDockerArgs[];
    runDocker: (args: RunDockerArgs) => Promise<RunDockerResult>;
  } {
    const calls: RunDockerArgs[] = [];
    return {
      calls,
      runDocker: async (args: RunDockerArgs) => {
        calls.push(args);
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, truncated: false };
      },
    };
  }

  test("spawn binds hostWorkdir to /work and sets -w /work + session.sessionWorkdir", async () => {
    const host = await mkdtemp(join(tmpdir(), "oddjob-docker-test-"));
    try {
      const stub = makeStub();
      const provider = new DockerEnvironmentProvider({ runDocker: stub.runDocker });
      const session = await provider.spawn({ hostWorkdir: host });
      expect(session.sessionWorkdir).toBe("/work");
      // First call must be the `docker run` invocation that bind-mounts host
      // to /work AND sets the container's working dir to /work (not the host
      // path — regression for 15i-1).
      const runArgv = stub.calls[0]?.argv ?? [];
      const dashV = runArgv.indexOf("-v");
      expect(dashV).toBeGreaterThan(-1);
      expect(runArgv[dashV + 1]).toBe(`${host}:/work`);
      const dashW = runArgv.indexOf("-w");
      expect(dashW).toBeGreaterThan(-1);
      expect(runArgv[dashW + 1]).toBe("/work");
      // No `-w <host-path>` anywhere in the argv: tools' default cwd must
      // resolve to /work, not the host blueprint dir.
      expect(runArgv).not.toContain(host);
    } finally {
      await rm(host, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("custom sessionWorkdir override is honored end-to-end", async () => {
    const host = await mkdtemp(join(tmpdir(), "oddjob-docker-test-"));
    try {
      const stub = makeStub();
      const provider = new DockerEnvironmentProvider({ runDocker: stub.runDocker });
      const session = await provider.spawn({ hostWorkdir: host, sessionWorkdir: "/srv/app" });
      expect(session.sessionWorkdir).toBe("/srv/app");
      const runArgv = stub.calls[0]?.argv ?? [];
      const dashV = runArgv.indexOf("-v");
      expect(runArgv[dashV + 1]).toBe(`${host}:/srv/app`);
      const dashW = runArgv.indexOf("-w");
      expect(runArgv[dashW + 1]).toBe("/srv/app");
    } finally {
      await rm(host, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("EnvironmentConfig.workingDir flows to sessionWorkdir, NOT hostWorkdir (codex round-3)", async () => {
    // Regression: pre-round-3 loop.ts folded workingDir into hostWorkdir, so
    // declaring `working_dir = "/srv/app"` on a docker Environment caused
    // Docker to try to bind HOST `/srv/app` (doesn't exist) into the
    // container. Now `workingDir` is correctly treated as sandbox-internal.
    const host = await mkdtemp(join(tmpdir(), "oddjob-docker-test-"));
    try {
      const stub = makeStub();
      const provider = new DockerEnvironmentProvider({ runDocker: stub.runDocker });
      const session = await provider.spawn({
        hostWorkdir: host,
        config: { type: "cloud", workingDir: "/srv/app" },
      });
      expect(session.sessionWorkdir).toBe("/srv/app");
      const runArgv = stub.calls[0]?.argv ?? [];
      const dashV = runArgv.indexOf("-v");
      // Bind source MUST be the host blueprint dir, not the in-container path.
      expect(runArgv[dashV + 1]).toBe(`${host}:/srv/app`);
      const dashW = runArgv.indexOf("-w");
      expect(runArgv[dashW + 1]).toBe("/srv/app");
      expect(runArgv).not.toContain("/srv/app:/srv/app"); // no host=/srv/app bind
    } finally {
      await rm(host, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("EnvironmentConfig.hostBindDir overrides the runtime hostWorkdir (operator advanced)", async () => {
    // hostBindDir lets an operator declare a different on-disk source when
    // the blueprint dir isn't the right thing to bind (e.g. shipping a /srv
    // tree separately from the .toml).
    const host = await mkdtemp(join(tmpdir(), "oddjob-docker-test-"));
    const altHost = await mkdtemp(join(tmpdir(), "oddjob-docker-alt-"));
    try {
      const stub = makeStub();
      const provider = new DockerEnvironmentProvider({ runDocker: stub.runDocker });
      const session = await provider.spawn({
        hostWorkdir: host, // would-be runtime default
        config: { type: "cloud", hostBindDir: altHost, workingDir: "/srv/app" },
      });
      expect(session.sessionWorkdir).toBe("/srv/app");
      const runArgv = stub.calls[0]?.argv ?? [];
      const dashV = runArgv.indexOf("-v");
      // hostBindDir wins for the bind source; workingDir wins for sessionWorkdir.
      expect(runArgv[dashV + 1]).toBe(`${altHost}:/srv/app`);
    } finally {
      await rm(host, { recursive: true, force: true }).catch(() => undefined);
      await rm(altHost, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("legacy `workdir` field still maps to host bind (back-compat)", async () => {
    const host = await mkdtemp(join(tmpdir(), "oddjob-docker-test-"));
    try {
      const stub = makeStub();
      const provider = new DockerEnvironmentProvider({ runDocker: stub.runDocker });
      const session = await provider.spawn({ workdir: host });
      expect(session.sessionWorkdir).toBe("/work");
      const runArgv = stub.calls[0]?.argv ?? [];
      const dashV = runArgv.indexOf("-v");
      expect(runArgv[dashV + 1]).toBe(`${host}:/work`);
    } finally {
      await rm(host, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("session exec without options uses sessionWorkdir as -w arg", async () => {
    const host = await mkdtemp(join(tmpdir(), "oddjob-docker-test-"));
    try {
      const stub = makeStub();
      const provider = new DockerEnvironmentProvider({ runDocker: stub.runDocker });
      const session = await provider.spawn({ hostWorkdir: host });
      stub.calls.length = 0;
      await session.exec("true");
      const execArgv = stub.calls[0]?.argv ?? [];
      const dashW = execArgv.indexOf("-w");
      expect(dashW).toBeGreaterThan(-1);
      expect(execArgv[dashW + 1]).toBe("/work");
      // Must NOT pass the host path as the docker exec -w value: that's the
      // bug 15i-1 fixed.
      expect(execArgv).not.toContain(host);
    } finally {
      await rm(host, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

describe("DockerEnvironmentProvider egress proxy reachability (unit, stubbed runDocker)", () => {
  function makeStub(): {
    calls: RunDockerArgs[];
    runDocker: (args: RunDockerArgs) => Promise<RunDockerResult>;
  } {
    const calls: RunDockerArgs[] = [];
    return {
      calls,
      runDocker: async (args: RunDockerArgs) => {
        calls.push(args);
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, truncated: false };
      },
    };
  }

  test("loopback proxy URL is rewritten to host.docker.internal in container env", async () => {
    const host = await mkdtemp(join(tmpdir(), "oddjob-docker-proxy-"));
    try {
      const stub = makeStub();
      const provider = new DockerEnvironmentProvider({ runDocker: stub.runDocker });
      await provider.spawn({
        hostWorkdir: host,
        egressProxy: { url: "http://oddjob:t0k@127.0.0.1:8888", caPem: "" },
      });
      const envFile = await readFile(join(host, ".oddjob-env"), "utf8");
      // Loopback rewritten to host.docker.internal so the container can
      // actually reach the operator-bound proxy.
      expect(envFile).toContain("HTTPS_PROXY=http://oddjob:t0k@host.docker.internal:8888");
      expect(envFile).toContain("http_proxy=http://oddjob:t0k@host.docker.internal:8888");
      expect(envFile).not.toContain("127.0.0.1");

      // docker run argv must add the host-gateway alias on Linux.
      const runArgv = stub.calls[0]?.argv ?? [];
      const addHostIdx = runArgv.indexOf("--add-host");
      expect(addHostIdx).toBeGreaterThan(-1);
      expect(runArgv[addHostIdx + 1]).toBe("host.docker.internal:host-gateway");
    } finally {
      await rm(host, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("public-IP proxy URL is preserved verbatim and host-gateway is NOT added", async () => {
    const host = await mkdtemp(join(tmpdir(), "oddjob-docker-proxy-"));
    try {
      const stub = makeStub();
      const provider = new DockerEnvironmentProvider({ runDocker: stub.runDocker });
      await provider.spawn({
        hostWorkdir: host,
        // Public IP — no rewrite, no host-gateway alias needed.
        egressProxy: { url: "http://oddjob:t0k@203.0.113.10:8888", caPem: "" },
      });
      const envFile = await readFile(join(host, ".oddjob-env"), "utf8");
      expect(envFile).toContain("HTTPS_PROXY=http://oddjob:t0k@203.0.113.10:8888");
      const runArgv = stub.calls[0]?.argv ?? [];
      expect(runArgv).not.toContain("--add-host");
    } finally {
      await rm(host, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("RFC1918 bridge gateway proxy URL is rewritten to host.docker.internal", async () => {
    const host = await mkdtemp(join(tmpdir(), "oddjob-docker-proxy-"));
    try {
      const stub = makeStub();
      const provider = new DockerEnvironmentProvider({ runDocker: stub.runDocker });
      // 172.17.0.1 is the typical Linux docker bridge gateway. Runtime
      // (loop.ts) binds the proxy there after asking proxyBindAddress();
      // env-docker must still rewrite the URL the container sees so it goes
      // through the host.docker.internal alias rather than chasing a host
      // address that's unreachable from inside the container's net namespace.
      await provider.spawn({
        hostWorkdir: host,
        egressProxy: { url: "http://oddjob:t0k@172.17.0.1:8888", caPem: "" },
      });
      const envFile = await readFile(join(host, ".oddjob-env"), "utf8");
      expect(envFile).toContain("host.docker.internal:8888");
      expect(envFile).not.toContain("172.17.0.1");
      const runArgv = stub.calls[0]?.argv ?? [];
      const addHostIdx = runArgv.indexOf("--add-host");
      expect(addHostIdx).toBeGreaterThan(-1);
      expect(runArgv[addHostIdx + 1]).toBe("host.docker.internal:host-gateway");
    } finally {
      await rm(host, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("proxyBindAddress on Linux returns docker bridge gateway IP", async () => {
    if (process.platform !== "linux") return; // Mac/Win path returns undefined; covered below.
    const stub = {
      calls: [] as RunDockerArgs[],
      runDocker: async (args: RunDockerArgs) => {
        stub.calls.push(args);
        return {
          exitCode: 0,
          stdout: "172.17.0.1\n",
          stderr: "",
          durationMs: 1,
          truncated: false,
        };
      },
    };
    const provider = new DockerEnvironmentProvider({ runDocker: stub.runDocker });
    const addr = await provider.proxyBindAddress();
    expect(addr).toBe("172.17.0.1");
    // Verify we shelled out to the right command shape.
    const argv = stub.calls[0]?.argv ?? [];
    expect(argv.slice(0, 4)).toEqual(["docker", "network", "inspect", "bridge"]);
    expect(argv).toContain("--format");
  });

  test("proxyBindAddress on Linux THROWS when bridge inspect fails (no silent fallback)", async () => {
    if (process.platform !== "linux") return;
    const provider = new DockerEnvironmentProvider({
      runDocker: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "no such network",
        durationMs: 1,
        truncated: false,
      }),
    });
    // Codex round-2 MED 1: returning undefined here would let the runtime
    // silently bind on 127.0.0.1, where the container can't reach it.
    await expect(provider.proxyBindAddress()).rejects.toThrow(/cannot discover/);
  });

  test("proxyBindAddress on Linux THROWS when output isn't an IPv4 dotted-quad", async () => {
    if (process.platform !== "linux") return;
    const provider = new DockerEnvironmentProvider({
      runDocker: async () => ({
        exitCode: 0,
        stdout: "<no value>\n",
        stderr: "",
        durationMs: 1,
        truncated: false,
      }),
    });
    await expect(provider.proxyBindAddress()).rejects.toThrow(/cannot discover/);
  });

  test("proxyBindAddress on non-Linux returns undefined (Docker Desktop hides the bug)", async () => {
    if (process.platform === "linux") return;
    const provider = new DockerEnvironmentProvider({
      runDocker: async () => ({
        exitCode: 0,
        stdout: "172.17.0.1\n",
        stderr: "",
        durationMs: 1,
        truncated: false,
      }),
    });
    expect(await provider.proxyBindAddress()).toBeUndefined();
  });

  test("kill() unlinks .oddjob-env (and CA) even when caller owns the workdir", async () => {
    const host = await mkdtemp(join(tmpdir(), "oddjob-docker-cleanup-"));
    try {
      const stub = makeStub();
      const provider = new DockerEnvironmentProvider({ runDocker: stub.runDocker });
      const session = await provider.spawn({
        hostWorkdir: host, // caller-owned
        egressProxy: { url: "http://oddjob:t0k@127.0.0.1:8888", caPem: "PEM-BYTES" },
      });
      // Both artifacts must exist immediately after spawn.
      expect(await readFile(join(host, ".oddjob-env"), "utf8")).toContain("HTTPS_PROXY=");
      expect(await readFile(join(host, ".oddjob-ca.pem"), "utf8")).toBe("PEM-BYTES");
      await session.kill();
      // After kill both must be gone — the per-Run auth token in .oddjob-env
      // must NOT persist in the operator-owned workdir.
      await expect(readFile(join(host, ".oddjob-env"), "utf8")).rejects.toThrow();
      await expect(readFile(join(host, ".oddjob-ca.pem"), "utf8")).rejects.toThrow();
    } finally {
      await rm(host, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("localhost (named) is also rewritten to host.docker.internal", async () => {
    const host = await mkdtemp(join(tmpdir(), "oddjob-docker-proxy-"));
    try {
      const stub = makeStub();
      const provider = new DockerEnvironmentProvider({ runDocker: stub.runDocker });
      await provider.spawn({
        hostWorkdir: host,
        egressProxy: { url: "http://oddjob:t0k@localhost:8888", caPem: "" },
      });
      const envFile = await readFile(join(host, ".oddjob-env"), "utf8");
      expect(envFile).toContain("host.docker.internal:8888");
      expect(envFile).not.toContain("@localhost:");
    } finally {
      await rm(host, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
