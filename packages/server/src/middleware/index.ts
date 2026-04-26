export type Handler = (req: Request, ctx: HandlerContext) => Promise<Response> | Response;

export interface HandlerContext {
  url: URL;
  params: Record<string, string>;
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

export function badRequest(message: string): Response {
  return json({ error: "bad_request", message }, { status: 400 });
}

export function notFound(message = "not found"): Response {
  return json({ error: "not_found", message }, { status: 404 });
}

export function unauthorized(message = "unauthorized"): Response {
  return json({ error: "unauthorized", message }, { status: 401 });
}

export function serverError(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  return json({ error: "server_error", message }, { status: 500 });
}

export function bearerCheck(req: Request, expected?: string): Response | undefined {
  if (!expected) return undefined;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${expected}`) return undefined;
  return unauthorized();
}

export async function readJson<T>(req: Request): Promise<T | undefined> {
  if (req.method === "GET" || req.method === "DELETE") return undefined;
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return undefined;
  try {
    return (await req.json()) as T;
  } catch {
    return undefined;
  }
}
