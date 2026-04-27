/**
 * Tiny `{{path}}` template resolver for channel config strings.
 *
 * Scope:
 *   input.<key>            — run input (top-level fields only; nested via dotted path)
 *   output.finalText       — the agent's terminal-message text
 *   output.structured.<k>  — fields from the validated structured output
 *   run.<id|deploymentId|blueprintId|startedAt|finishedAt|costUsd>
 *
 * Unresolved tokens are left as-is (`{{foo.bar}}`) so misconfigured templates
 * surface visibly instead of silently rendering empty.
 */
export interface TemplateContext {
  input?: unknown;
  output?: { finalText?: string; structured?: Record<string, unknown> };
  run?: Record<string, unknown>;
}

const TOKEN = /\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g;

export function renderTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(TOKEN, (whole, path: string) => {
    const value = lookup(ctx, path);
    if (value === undefined || value === null) return whole;
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

function lookup(ctx: TemplateContext, path: string): unknown {
  const parts = path.split(".");
  if (parts.length === 0) return undefined;
  const head = parts[0]!;
  let cursor: unknown;
  if (head === "input") cursor = ctx.input;
  else if (head === "output") cursor = ctx.output;
  else if (head === "run") cursor = ctx.run;
  else return undefined;

  for (let i = 1; i < parts.length; i++) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[parts[i]!];
  }
  return cursor;
}
