import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { Blueprint } from "../types/blueprint.ts";
import { type BlueprintIssue, BlueprintValidationError } from "./errors.ts";

const SCRIPT_EXTS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".sh", ".py"]);

export interface ValidateOptions {
  checkFs?: boolean;
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
