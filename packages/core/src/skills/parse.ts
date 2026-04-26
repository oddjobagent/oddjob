import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { load as parseYaml } from "js-yaml";

import type { Blueprint } from "../types/blueprint.ts";
import type { Skill, SkillFrontmatter } from "../types/skill.ts";

export interface LoadedSkill extends Skill {
  blueprintLocal: boolean;
}

const FRONTMATTER_RE = /^---\n([\s\S]+?)\n---\n([\s\S]*)$/;

export function parseSkillFile(content: string, path: string): Skill {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error(`SKILL.md at ${path}: missing YAML frontmatter (--- ... ---)`);
  }
  const fm = parseYaml(match[1]!) as Partial<SkillFrontmatter>;
  if (!fm || typeof fm !== "object") {
    throw new Error(`SKILL.md at ${path}: frontmatter must be an object`);
  }
  if (!fm.name || typeof fm.name !== "string") {
    throw new Error(`SKILL.md at ${path}: frontmatter requires a 'name' string`);
  }
  if (!fm.description || typeof fm.description !== "string") {
    throw new Error(`SKILL.md at ${path}: frontmatter requires a 'description' string`);
  }
  return {
    name: fm.name,
    description: fm.description,
    path,
    body: match[2]!.trim(),
    metadata: fm as Record<string, unknown>,
  };
}

export interface ResolveOptions {
  globalSkillsDir?: string;
}

export function resolveSkillPath(
  blueprint: Blueprint,
  skillName: string,
  opts: ResolveOptions = {},
): string | null {
  const blueprintDir = isAbsolute(blueprint.path) ? dirname(blueprint.path) : process.cwd();
  const local = join(blueprintDir, "skills", skillName, "SKILL.md");
  if (existsSync(local)) return local;
  if (opts.globalSkillsDir) {
    const global = join(opts.globalSkillsDir, skillName, "SKILL.md");
    if (existsSync(global)) return global;
  }
  return null;
}

export function loadSkills(blueprint: Blueprint, opts: ResolveOptions = {}): LoadedSkill[] {
  const out: LoadedSkill[] = [];
  for (const skillName of blueprint.skills) {
    const path = resolveSkillPath(blueprint, skillName, opts);
    if (!path) {
      throw new Error(`skill '${skillName}' not found (looked in ./skills/ and global)`);
    }
    const local = path.includes(`/skills/${skillName}/`);
    const skill = parseSkillFile(readFileSync(path, "utf8"), path);
    out.push({ ...skill, blueprintLocal: local });
  }
  return out;
}

export function blueprintDirOf(blueprint: Blueprint): string {
  return isAbsolute(blueprint.path) ? dirname(blueprint.path) : resolve(process.cwd());
}
