import type { Runtime } from "../runtime.ts";
import { type Handler, badRequest, json, readJson } from "../middleware/index.ts";

export const list =
  (rt: Runtime): Handler =>
  async () => {
    const names = await rt.secrets.list();
    return json({ secrets: names });
  };

export const set =
  (rt: Runtime): Handler =>
  async (req, ctx) => {
    const name = ctx.params.name ?? "";
    if (!name.match(/^[A-Z][A-Z0-9_]*$/)) return badRequest("name must be SCREAMING_SNAKE_CASE");
    const body = await readJson<{ value: string }>(req);
    if (!body || typeof body.value !== "string") return badRequest("body.value (string) required");
    await rt.secrets.set(name, body.value);
    return new Response(null, { status: 204 });
  };

export const remove =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    await rt.secrets.delete(ctx.params.name ?? "");
    return new Response(null, { status: 204 });
  };
