import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { SecretsSqliteProvider } from "./provider.ts";
import { open, seal } from "./vault.ts";

let dir: string;
let p: SecretsSqliteProvider;
const masterKey = Buffer.from("0".repeat(64), "hex");

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oddjob-secrets-"));
  p = new SecretsSqliteProvider({ path: join(dir, "secrets.db"), masterKey });
  await p.connect();
});

afterAll(async () => {
  await p.disconnect();
  await rm(dir, { recursive: true, force: true });
});

describe("secrets vault primitive", () => {
  test("seal+open round trip", () => {
    const sealed = seal("supersecret", masterKey);
    expect(open(sealed, masterKey)).toBe("supersecret");
  });

  test("tampering with ciphertext fails", () => {
    const sealed = seal("hello", masterKey);
    sealed.ciphertext[0] = (sealed.ciphertext[0] ?? 0) ^ 0xff;
    expect(() => open(sealed, masterKey)).toThrow();
  });
});

describe("SecretsSqliteProvider", () => {
  test("set / get / has / list / delete", async () => {
    expect(await p.has("X")).toBe(false);
    await p.set("X", "hello");
    expect(await p.has("X")).toBe(true);
    expect(await p.get("X")).toBe("hello");

    await p.set("Y", "another");
    const list = await p.list();
    expect(list).toContain("X");
    expect(list).toContain("Y");

    await p.delete("X");
    expect(await p.get("X")).toBeNull();
  });

  test("update overwrites previous value", async () => {
    await p.set("Z", "v1");
    await p.set("Z", "v2");
    expect(await p.get("Z")).toBe("v2");
  });

  test("get of missing returns null", async () => {
    expect(await p.get("MISSING")).toBeNull();
  });
});
