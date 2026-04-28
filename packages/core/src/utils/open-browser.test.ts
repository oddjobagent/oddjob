import { describe, expect, test } from "bun:test";

import { openBrowser } from "./open-browser.ts";

interface SpawnCall {
  cmd: string[];
}

function makeSpawn(): { calls: SpawnCall[]; impl: typeof Bun.spawn } {
  const calls: SpawnCall[] = [];
  const impl = ((cmd: string[]) => {
    calls.push({ cmd });
    return {
      exited: Promise.resolve(0),
      kill: () => undefined,
    } as unknown as ReturnType<typeof Bun.spawn>;
  }) as unknown as typeof Bun.spawn;
  return { calls, impl };
}

describe("openBrowser", () => {
  test("uses `open` on darwin", async () => {
    if (process.platform !== "darwin") return;
    const { calls, impl } = makeSpawn();
    await openBrowser("https://example.com/x", { spawnImpl: impl });
    expect(calls[0]?.cmd).toEqual(["open", "https://example.com/x"]);
  });

  test("uses `xdg-open` on linux", async () => {
    if (process.platform !== "linux") return;
    const { calls, impl } = makeSpawn();
    await openBrowser("https://example.com/x", { spawnImpl: impl });
    expect(calls[0]?.cmd).toEqual(["xdg-open", "https://example.com/x"]);
  });

  test("uses `cmd /c start` on win32", async () => {
    if (process.platform !== "win32") return;
    const { calls, impl } = makeSpawn();
    await openBrowser("https://example.com/x", { spawnImpl: impl });
    expect(calls[0]?.cmd).toEqual(["cmd", "/c", "start", "", "https://example.com/x"]);
  });

  test("rejects non-http(s) URLs", async () => {
    const { impl } = makeSpawn();
    await expect(openBrowser("file:///etc/passwd", { spawnImpl: impl })).rejects.toThrow(
      /non-http/,
    );
    await expect(openBrowser("javascript:alert(1)" as string, { spawnImpl: impl })).rejects.toThrow(
      /non-http/,
    );
    await expect(openBrowser("ftp://example.com/x", { spawnImpl: impl })).rejects.toThrow(
      /non-http/,
    );
  });

  test("rejects invalid URLs", async () => {
    const { impl } = makeSpawn();
    await expect(openBrowser("not a url", { spawnImpl: impl })).rejects.toThrow(/invalid URL/);
  });

  test("accepts http and https", async () => {
    const { calls, impl } = makeSpawn();
    await openBrowser("http://localhost:1234/cb", { spawnImpl: impl });
    await openBrowser("https://accounts.google.com/o", { spawnImpl: impl });
    expect(calls.length).toBe(2);
  });
});
