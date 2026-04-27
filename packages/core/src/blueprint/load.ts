import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
  const parsed = parseBlueprint(source, { path: tomlPath });
  const blueprint = await resolveSchemaSidecars(parsed);
  if (options.validate !== false) {
    validateBlueprint(blueprint, { checkFs: options.checkFs ?? true });
  }
  return blueprint;
}

async function resolveSchemaSidecars(blueprint: Blueprint): Promise<Blueprint> {
  let next = blueprint;
  if (next.outputSchemaFile) {
    const schema = await resolveSidecar(
      next.outputSchemaFile,
      next.path,
      "output_schema.json_schema_file",
    );
    next = { ...next, outputSchema: { type: "json-schema", schema }, outputSchemaFile: undefined };
  }
  if (next.inputSchemaFile) {
    const schema = await resolveSidecar(
      next.inputSchemaFile,
      next.path,
      "input_schema.json_schema_file",
    );
    next = { ...next, inputSchema: { type: "json-schema", schema }, inputSchemaFile: undefined };
  }
  if (next.outcomes?.grader?.rubricFile && !next.outcomes.grader.rubricLoaded) {
    const tomlDir = dirname(next.path);
    const ref = next.outcomes.grader.rubricFile;
    const abs = isAbsolute(ref) ? ref : resolve(tomlDir, ref);
    try {
      const rubric = await readFile(abs, "utf8");
      next = {
        ...next,
        outcomes: {
          ...next.outcomes,
          grader: { ...next.outcomes.grader, rubricLoaded: rubric },
        },
      };
    } catch (err) {
      throw new BlueprintParseError(
        `outcomes.grader.rubric_file '${ref}': ${(err as Error).message}`,
        err,
      );
    }
  }
  return next;
}

async function resolveSidecar(
  ref: string,
  blueprintPath: string,
  where: string,
): Promise<Record<string, unknown>> {
  const tomlDir = dirname(blueprintPath);
  const abs = isAbsolute(ref) ? ref : resolve(tomlDir, ref);
  const ext = abs.slice(abs.lastIndexOf(".")).toLowerCase();
  try {
    if (ext === ".json") {
      const raw = await readFile(abs, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("sidecar JSON must be an object");
      }
      return parsed as Record<string, unknown>;
    }
    if (ext === ".ts" || ext === ".js" || ext === ".mjs") {
      const mod = (await import(pathToFileURL(abs).href)) as { default?: unknown };
      const def = mod.default;
      if (!def || typeof def !== "object" || Array.isArray(def)) {
        throw new Error(`sidecar must export default a JSON Schema object (got ${typeof def})`);
      }
      return def as Record<string, unknown>;
    }
    throw new Error(`unsupported sidecar extension '${ext}' (expected .json, .ts, .js, .mjs)`);
  } catch (err) {
    throw new BlueprintParseError(`${where} '${ref}': ${(err as Error).message}`, err);
  }
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
