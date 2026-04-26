import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import type { Blueprint } from "../types/blueprint.ts";
import { BlueprintParseError } from "./errors.ts";
import { parseBlueprint } from "./parse.ts";
import { validateBlueprint, type ValidateOptions } from "./validate.ts";

export interface LoadOptions extends ValidateOptions {
  validate?: boolean;
}

export async function loadBlueprint(
  pathOrDir: string,
  options: LoadOptions = { validate: true, checkFs: true },
): Promise<Blueprint> {
  const abs = isAbsolute(pathOrDir) ? pathOrDir : resolve(process.cwd(), pathOrDir);
  const tomlPath = await resolveBlueprintFile(abs);
  const source = await readFile(tomlPath, "utf8");
  const blueprint = parseBlueprint(source, { path: tomlPath });
  if (options.validate !== false) {
    validateBlueprint(blueprint, { checkFs: options.checkFs ?? true });
  }
  return blueprint;
}

async function resolveBlueprintFile(absPath: string): Promise<string> {
  try {
    const s = await stat(absPath);
    if (s.isDirectory()) {
      return join(absPath, "blueprint.toml");
    }
    return absPath;
  } catch (err) {
    throw new BlueprintParseError(`Cannot read blueprint at ${absPath}`, err);
  }
}
