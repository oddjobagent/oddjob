import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { BUILTIN_TOOL_NAMES } from "../agent/builtin-tools/index.ts";
import type { Blueprint } from "../types/blueprint.ts";
import { type BlueprintIssue, BlueprintValidationError } from "./errors.ts";

const SCRIPT_EXTS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".sh", ".py"]);
const BUILTIN_NAMES_SET: ReadonlySet<string> = new Set(BUILTIN_TOOL_NAMES);

export interface ValidateOptions {
  checkFs?: boolean;
  /**
   * Tool names contributed by plugins. Validator accepts them in addition to
   * the bundled built-in list. Pass enabled plugin tool names from the server
   * boot path; CLI validation without a registry context just gets builtins.
   */
  pluginToolNames?: ReadonlySet<string>;
}

export function validateBlueprint(
  blueprint: Blueprint,
  options: ValidateOptions = { checkFs: true },
): void {
  const issues: BlueprintIssue[] = [];
  const dir = blueprintDir(blueprint);

  for (const [toolName, scriptPath] of Object.entries(blueprint.scripts)) {
    if (!toolName.match(/^[a-z0-9][a-z0-9_]*$/)) {
      issues.push({
        path: `scripts.${toolName}`,
        message: "script tool name must be lowercase letters, digits, underscores",
      });
      continue;
    }
    if (isAbsolute(scriptPath)) {
      issues.push({
        path: `scripts.${toolName}`,
        message: "script path must be relative to the blueprint directory",
      });
      continue;
    }
    const abs = resolve(dir, scriptPath);
    const rel = relative(dir, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      issues.push({
        path: `scripts.${toolName}`,
        message: `script path escapes blueprint directory: ${scriptPath}`,
      });
      continue;
    }
    if (options.checkFs) {
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        issues.push({
          path: `scripts.${toolName}`,
          message: `script not found: ${scriptPath}`,
        });
        continue;
      }
      const ext = extOf(abs);
      if (!SCRIPT_EXTS.has(ext)) {
        issues.push({
          path: `scripts.${toolName}`,
          message: `script extension '${ext}' is not executable; expected one of ${[...SCRIPT_EXTS].join(", ")}`,
        });
      }
    }
  }

  if (options.checkFs) {
    for (const skillName of blueprint.skills) {
      if (!skillName.match(/^[a-z0-9][a-z0-9-]*$/)) {
        issues.push({
          path: `skills`,
          message: `skill name '${skillName}' must be lowercase letters, digits, hyphens`,
        });
        continue;
      }
      const skillDir = resolve(dir, "skills", skillName);
      const skillFile = resolve(skillDir, "SKILL.md");
      if (!existsSync(skillFile)) {
        issues.push({
          path: `skills.${skillName}`,
          message: `SKILL.md not found at ${skillFile}`,
        });
      }
    }
  }

  for (const toolName of blueprint.tools) {
    if (BUILTIN_NAMES_SET.has(toolName)) continue;
    if (options.pluginToolNames?.has(toolName)) continue;
    const suggestion = nearestBuiltin(toolName);
    issues.push({
      path: "tools",
      message: suggestion
        ? `unknown tool '${toolName}' (did you mean '${suggestion}'?)`
        : `unknown tool '${toolName}' (valid built-ins: ${[...BUILTIN_NAMES_SET].join(", ")}; plugin-contributed tools: ${
            options.pluginToolNames && options.pluginToolNames.size > 0
              ? [...options.pluginToolNames].join(", ")
              : "(none)"
          })`,
    });
  }
  for (const toolName of blueprint.tools) {
    if (Object.hasOwn(blueprint.scripts, toolName)) {
      issues.push({
        path: `tools`,
        message: `built-in tool '${toolName}' collides with a script of the same name; rename the script`,
      });
    }
  }

  for (const secretRef of Object.values(blueprint.secrets)) {
    if (!secretRef.match(/^[A-Z][A-Z0-9_]*$/)) {
      issues.push({
        path: "secrets",
        message: `secret reference '${secretRef}' should be SCREAMING_SNAKE_CASE`,
      });
    }
  }

  for (const [name, conn] of Object.entries(blueprint.connectors)) {
    if (conn.auth.kind === "api_key" || conn.auth.kind === "bearer") {
      if (!conn.auth.secretRef) {
        issues.push({
          path: `connectors.${name}.auth`,
          message: "secretRef required for api_key/bearer auth",
        });
      }
    }
  }

  if (blueprint.outputSchemaFile) {
    issues.push({
      path: "output_schema.json_schema_file",
      message:
        `unresolved sidecar '${blueprint.outputSchemaFile}'. Sidecar files are resolved by the CLI at push/load time — ` +
        "if you see this on the server, the blueprint was sent without sidecar resolution.",
    });
  }
  if (blueprint.inputSchemaFile) {
    issues.push({
      path: "input_schema.json_schema_file",
      message: `unresolved sidecar '${blueprint.inputSchemaFile}' (CLI/load-time resolution required)`,
    });
  }
  if (blueprint.inputSchema) {
    const root = blueprint.inputSchema.schema;
    if (!root || typeof root !== "object") {
      issues.push({ path: "input_schema.schema", message: "must be an object" });
    } else if (root.type !== "object") {
      issues.push({
        path: "input_schema.schema.type",
        message: 'top-level JSON Schema must have type: "object"',
      });
    }
  }
  if (blueprint.outputSchema) {
    const root = blueprint.outputSchema.schema;
    if (!root || typeof root !== "object") {
      issues.push({ path: "output_schema.schema", message: "must be an object" });
    } else if (root.type !== "object") {
      issues.push({
        path: "output_schema.schema.type",
        message: 'top-level JSON Schema must have type: "object"',
      });
    } else if (
      root.properties !== undefined &&
      (typeof root.properties !== "object" ||
        root.properties === null ||
        Array.isArray(root.properties))
    ) {
      issues.push({
        path: "output_schema.schema.properties",
        message: "must be an object",
      });
    }
  }

  // Either `model` (legacy) or `requires.roles` must declare what model the
  // blueprint expects. A blueprint with neither is unusable at dispatch.
  if (!blueprint.model && !blueprint.requires?.roles?.length) {
    issues.push({
      path: "model",
      message:
        'blueprint must declare a model — either set `[requires] roles = ["default"]` and assign engine roles, or use the legacy top-level `model = "..."`',
    });
  }

  if (issues.length > 0) {
    throw new BlueprintValidationError(issues);
  }
}

function blueprintDir(blueprint: Blueprint): string {
  return isAbsolute(blueprint.path) ? dirname(blueprint.path) : process.cwd();
}

function extOf(p: string): string {
  const dot = p.lastIndexOf(".");
  return dot === -1 ? "" : p.slice(dot);
}

function nearestBuiltin(input: string): string | undefined {
  const lower = input.toLowerCase();
  let best: string | undefined;
  let bestScore = Infinity;
  for (const name of BUILTIN_NAMES_SET) {
    const score = levenshtein(lower, name);
    if (score < bestScore && score <= 2) {
      best = name;
      bestScore = score;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = a[i - 1] === b[j - 1] ? prevDiag : 1 + Math.min(prevDiag, prev[j - 1]!, prev[j]!);
      prevDiag = tmp;
    }
  }
  return prev[b.length]!;
}
