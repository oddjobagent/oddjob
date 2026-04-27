import Ajv from "ajv";
import addFormats from "ajv-formats";

import type { Blueprint } from "../types/blueprint.ts";
import type { OutputValidation, OutputValidationError } from "../types/run.ts";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export function validateOutput(
  blueprint: Blueprint,
  structuredOutput: Record<string, unknown> | undefined,
): OutputValidation {
  const schemaWrapper = blueprint.outputSchema;
  if (!schemaWrapper) return { ok: true, source: "skipped" };
  if (schemaWrapper.type !== "json-schema") return { ok: true, source: "skipped" };

  if (structuredOutput === undefined || structuredOutput === null) {
    return {
      ok: false,
      source: "no-output",
      errors: [
        {
          path: "$",
          message: "blueprint declares output_schema but no structured output was produced",
        },
      ],
    };
  }

  let validate;
  try {
    validate = ajv.compile(schemaWrapper.schema);
  } catch (e) {
    return {
      ok: false,
      source: "json-schema",
      errors: [{ path: "$", message: `schema compile failed: ${(e as Error).message}` }],
    };
  }

  const ok = validate(structuredOutput);
  if (ok) return { ok: true, source: "json-schema" };

  const errors: OutputValidationError[] = (validate.errors ?? []).map((e) => ({
    path: e.instancePath || "$",
    message: e.message ?? "validation error",
  }));
  return { ok: false, source: "json-schema", errors };
}
