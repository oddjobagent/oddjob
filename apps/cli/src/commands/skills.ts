import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rm, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { defineCommand } from "citty";

import { parseSkillFile } from "@oddjob/agent";

interface SidecarMeta {
  name: string;
  source: string;
  commit?: string;
  pulledAt: number;
}

export default defineCommand({
  meta: { name: "skills", description: "Manage blueprint skills (./skills/)." },
  args: {
    action: { type: "positional", required: true, description: "add | list | remove" },
    source: {
      type: "positional",
      required: false,
      description: "GitHub user/repo[/path] or git URL or local path",
    },
    blueprintDir: { type: "string", default: ".", description: "Blueprint directory" },
    name: { type: "string", description: "Override skill name (default = directory name)" },
  },
  async run({ args }) {
    const skillsDir = resolve(args.blueprintDir, "skills");

    switch (args.action) {
      case "list": {
        if (!existsSync(skillsDir)) {
          process.stdout.write("(no skills directory)\n");
          return;
        }
        const entries = await readdir(skillsDir);
        for (const e of entries) {
          const skillPath = join(skillsDir, e, "SKILL.md");
          if (!existsSync(skillPath)) continue;
          try {
            const skill = parseSkillFile(await readFile(skillPath, "utf8"), skillPath);
            process.stdout.write(`${e.padEnd(20)}  ${skill.description}\n`);
          } catch (err) {
            process.stdout.write(`${e.padEnd(20)}  [INVALID: ${(err as Error).message}]\n`);
          }
        }
        break;
      }
      case "remove": {
        if (!args.source) throw new Error("usage: oddjob skills remove <name>");
        await rm(join(skillsDir, args.source), { recursive: true, force: true });
        process.stdout.write(`removed ${args.source}\n`);
        break;
      }
      case "add": {
        if (!args.source) throw new Error("usage: oddjob skills add <source>");
        await mkdir(skillsDir, { recursive: true });
        const meta = await fetchSkill(args.source, skillsDir, args.name);
        await writeFile(join(skillsDir, meta.name, ".skill.json"), JSON.stringify(meta, null, 2));
        process.stdout.write(
          `added ${meta.name} from ${meta.source}${meta.commit ? `@${meta.commit.slice(0, 7)}` : ""}\n`,
        );
        break;
      }
      default:
        process.stderr.write(`unknown action: ${args.action}\n`);
        process.exit(1);
    }
  },
});

async function fetchSkill(
  source: string,
  skillsDir: string,
  nameOverride: string | undefined,
): Promise<SidecarMeta> {
  // Local path: copy directory
  if (source.startsWith("./") || source.startsWith("../") || source.startsWith("/")) {
    const abs = resolve(source);
    const s = await stat(abs);
    if (!s.isDirectory()) throw new Error(`not a directory: ${source}`);
    const skillName = nameOverride ?? abs.split("/").pop()!;
    await cp(abs, join(skillsDir, skillName));
    return { name: skillName, source: `local:${abs}`, pulledAt: Date.now() };
  }

  // git URL or github shorthand: user/repo[/subpath]
  const tmp = `/tmp/oddjob-skill-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let url: string;
  let subpath = "";
  if (
    source.startsWith("git://") ||
    source.startsWith("https://") ||
    source.startsWith("http://") ||
    source.endsWith(".git")
  ) {
    url = source;
  } else {
    const parts = source.split("/");
    if (parts.length < 2) throw new Error(`invalid GitHub source: ${source}`);
    url = `https://github.com/${parts[0]}/${parts[1]}.git`;
    subpath = parts.slice(2).join("/");
  }
  await runCmd("git", ["clone", "--depth=1", url, tmp]);
  const commit = (await runCmd("git", ["-C", tmp, "rev-parse", "HEAD"])).stdout.trim();

  let skillSrc = tmp;
  if (subpath) skillSrc = join(tmp, subpath);
  if (!existsSync(join(skillSrc, "SKILL.md"))) {
    await rm(tmp, { recursive: true, force: true });
    throw new Error(`no SKILL.md found at ${subpath || "(repo root)"} of ${url}`);
  }
  const skillName = nameOverride ?? subpath.split("/").pop() ?? source.split("/").pop()!;
  await cp(skillSrc, join(skillsDir, skillName));
  await rm(tmp, { recursive: true, force: true });
  return {
    name: skillName,
    source: `git:${url}${subpath ? `#${subpath}` : ""}`,
    commit,
    pulledAt: Date.now(),
  };
}

async function cp(src: string, dst: string): Promise<void> {
  await rm(dst, { recursive: true, force: true });
  await mkdir(dst, { recursive: true });
  await runCmd("cp", ["-R", `${src}/.`, dst]);
}

async function runCmd(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolveCmd, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      if (code === 0) resolveCmd({ stdout, stderr, code });
      else reject(new Error(`${cmd} ${args.join(" ")} exit ${code}: ${stderr}`));
    });
    child.on("error", reject);
  });
}
