import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { defineCommand } from "citty";

import { loadBlueprint } from "@oddjob/core";

import { api } from "../lib/api.ts";

export default defineCommand({
  meta: {
    name: "pull",
    description: "Clone a blueprint from GitHub or a git URL and (optionally) push it to the server.",
  },
  args: {
    source: {
      type: "positional",
      required: true,
      description: "github user/repo[/subpath] or git URL",
    },
    dest: {
      type: "string",
      description: "Local directory to keep the clone at (default ./<repo-name>)",
    },
    push: { type: "boolean", default: true, description: "Push the blueprint after cloning" },
  },
  async run({ args }) {
    const { url, subpath, repoName } = parseSource(args.source);
    const dest = resolve(args.dest ?? `./${repoName}`);
    if (existsSync(dest)) {
      const s = await stat(dest);
      if (s.isDirectory()) throw new Error(`destination already exists: ${dest}`);
    }
    const tmp = `/tmp/oddjob-pull-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    process.stdout.write(`cloning ${url}…\n`);
    await runCmd("git", ["clone", "--depth=1", url, tmp]);
    const commit = (await runCmd("git", ["-C", tmp, "rev-parse", "HEAD"])).stdout.trim();
    const blueprintSrc = subpath ? join(tmp, subpath) : tmp;
    if (!existsSync(join(blueprintSrc, "blueprint.toml"))) {
      await rm(tmp, { recursive: true, force: true });
      throw new Error(`no blueprint.toml at ${subpath || "(repo root)"}`);
    }
    await mkdir(dest, { recursive: true });
    await runCmd("cp", ["-R", `${blueprintSrc}/.`, dest]);
    await rm(tmp, { recursive: true, force: true });
    process.stdout.write(`cloned to ${dest} @${commit.slice(0, 7)}\n`);

    if (args.push) {
      const bp = await loadBlueprint(dest, { validate: true, checkFs: true });
      await api.blueprints.push({ blueprint: bp });
      process.stdout.write(`pushed ${bp.id}\n`);
    }
  },
});

function parseSource(source: string): { url: string; subpath: string; repoName: string } {
  if (
    source.startsWith("git://") ||
    source.startsWith("https://") ||
    source.startsWith("http://") ||
    source.endsWith(".git")
  ) {
    const m = source.match(/\/([^/]+?)(?:\.git)?$/);
    return { url: source, subpath: "", repoName: m?.[1] ?? "blueprint" };
  }
  const parts = source.split("/");
  if (parts.length < 2) throw new Error(`invalid github shorthand: ${source}`);
  return {
    url: `https://github.com/${parts[0]}/${parts[1]}.git`,
    subpath: parts.slice(2).join("/"),
    repoName: parts.slice(2).pop() ?? parts[1] ?? "blueprint",
  };
}

async function runCmd(
  cmd: string,
  cmdArgs: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolveCmd, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code === 0) resolveCmd({ stdout, stderr, code });
      else reject(new Error(`${cmd} ${cmdArgs.join(" ")} exit ${code}: ${stderr}`));
    });
    child.on("error", reject);
  });
}
