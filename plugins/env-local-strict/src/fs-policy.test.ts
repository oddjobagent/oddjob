import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { resolveInsideStrict, validateStrictWorkdir } from "./fs-policy.ts";

describe("validateStrictWorkdir", () => {
  test("rejects '/'", async () => {
    await expect(validateStrictWorkdir("/")).rejects.toThrow(/forbidden system root/);
  });

  test("rejects empty + relative + non-absolute", async () => {
    await expect(validateStrictWorkdir("")).rejects.toThrow(/workdir/);
    await expect(validateStrictWorkdir("relative/path")).rejects.toThrow(/absolute/);
  });

  test("rejects known-dangerous system roots", async () => {
    for (const root of ["/etc", "/usr", "/bin", "/sbin", "/var", "/dev"]) {
      try {
        await validateStrictWorkdir(root);
        throw new Error(`expected validateStrictWorkdir(${root}) to reject`);
      } catch (err) {
        expect((err as Error).message).toMatch(/forbidden system root|does not exist/);
      }
    }
  });

  test("accepts a fresh subdir of tmpdir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oddjob-fs-policy-"));
    await validateStrictWorkdir(dir);
  });

  test("accepts a normal user-owned directory (e.g. blueprint dir)", async () => {
    await validateStrictWorkdir(process.cwd());
  });

  test("rejects a non-existent path", async () => {
    const fake = join(tmpdir(), "oddjob-does-not-exist-xyzzy");
    await expect(validateStrictWorkdir(fake)).rejects.toThrow(/does not exist|not accessible/);
  });
});

describe("resolveInsideStrict", () => {
  test("rejects empty", async () => {
    await expect(resolveInsideStrict("/tmp/wd", "")).rejects.toThrow(/empty path/);
  });

  test("joins relative paths to root", async () => {
    const root = await mkdtemp(join(tmpdir(), "oddjob-rinside-"));
    const out = await resolveInsideStrict(root, "a.txt");
    expect(out).toBe(join(root, "a.txt"));
  });

  test("rejects relative path that escapes via ..", async () => {
    const root = await mkdtemp(join(tmpdir(), "oddjob-rinside-"));
    await expect(resolveInsideStrict(root, "../escape.txt")).rejects.toThrow(/refusing path outside/);
    await expect(resolveInsideStrict(root, "a/../../escape.txt")).rejects.toThrow(/refusing path outside/);
  });

  test("accepts absolute path that resolves inside root", async () => {
    const root = await mkdtemp(join(tmpdir(), "oddjob-rinside-"));
    const out = await resolveInsideStrict(root, join(root, "inside.txt"));
    expect(out).toBe(join(root, "inside.txt"));
  });

  test("rejects absolute path outside root", async () => {
    const root = await mkdtemp(join(tmpdir(), "oddjob-rinside-"));
    await expect(resolveInsideStrict(root, "/etc/passwd")).rejects.toThrow(/refusing path outside/);
  });

  test("rejects symlink-escape: file inside workdir is a symlink to /etc/passwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "oddjob-symlink-"));
    await symlink("/etc/passwd", join(root, "shadow"));
    await expect(resolveInsideStrict(root, "shadow")).rejects.toThrow(/symlink-escape/);
  });

  test("rejects symlink-escape: directory inside workdir is a symlink to /etc", async () => {
    const root = await mkdtemp(join(tmpdir(), "oddjob-symlink-"));
    await symlink("/etc", join(root, "evil"));
    await expect(resolveInsideStrict(root, "evil/passwd")).rejects.toThrow(/symlink-escape/);
  });

  test("accepts a not-yet-existing file inside a real subdir of workdir", async () => {
    const root = await mkdtemp(join(tmpdir(), "oddjob-newfile-"));
    await mkdir(join(root, "subdir"));
    const out = await resolveInsideStrict(root, "subdir/newfile.txt");
    expect(out).toBe(join(root, "subdir", "newfile.txt"));
  });

  test("rejects writeFile target inside a symlinked subdir", async () => {
    const root = await mkdtemp(join(tmpdir(), "oddjob-symlink-"));
    await symlink("/tmp", join(root, "tmplink"));
    await expect(resolveInsideStrict(root, "tmplink/newfile.txt")).rejects.toThrow(/symlink-escape/);
  });

  test("accepts a workdir that is itself a symlink to another tmpdir", async () => {
    // macOS realpath resolves /tmp -> /private/tmp; the policy should still
    // accept reads/writes inside it because realpath(root) == realpath(file's dir).
    const real = await mkdtemp(join(tmpdir(), "oddjob-real-"));
    await writeFile(join(real, "ok.txt"), "x");
    const out = await resolveInsideStrict(real, "ok.txt");
    expect(out).toBe(join(real, "ok.txt"));
  });
});
