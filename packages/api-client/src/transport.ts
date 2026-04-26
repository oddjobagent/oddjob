export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface TransportOptions {
  /** Base URL for API requests, e.g. "http://127.0.0.1:7777". No trailing slash. */
  baseUrl: string;
  /** Bearer token sent as `Authorization: Bearer <token>` if present. */
  bearerToken?: string;
  /** Override fetch (for tests / SSR / custom). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
}

export type Transport = <T>(method: string, path: string, body?: unknown) => Promise<T>;

export function createTransport(opts: TransportOptions): Transport {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const base = opts.baseUrl.replace(/\/+$/, "");

  return async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${base}${path}`;
    const headers: Record<string, string> = {};
    if (opts.bearerToken) headers.authorization = `Bearer ${opts.bearerToken}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    const resp = await fetchImpl(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new ApiError(resp.status, `${method} ${path} -> ${resp.status} ${text}`);
    }
    if (resp.status === 204) return undefined as T;
    const ct = resp.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) return (await resp.json()) as T;
    return (await resp.text()) as unknown as T;
  };
}
