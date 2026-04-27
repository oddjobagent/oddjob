import { createApi, type OddjobApi } from "@oddjob/api-client";

const TOKEN_KEY = "ODDJOB_BEARER_TOKEN";
const AUTH_OVERRIDE_KEY = "ODDJOB_ALLOW_API_OVERRIDE";

function readBearerFromMeta(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const meta = document.querySelector('meta[name="x-oddjob-token"]');
  const v = meta?.getAttribute("content");
  return v && v.length > 0 ? v : undefined;
}

function readBearerFromStorage(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const v = window.localStorage?.getItem(TOKEN_KEY);
  return v && v.length > 0 ? v : undefined;
}

export function setBearerToken(value: string | undefined): void {
  if (typeof window === "undefined") return;
  if (!value) window.localStorage?.removeItem(TOKEN_KEY);
  else window.localStorage?.setItem(TOKEN_KEY, value);
}

export function getBearerToken(): string | undefined {
  return readBearerFromStorage() ?? readBearerFromMeta();
}

function resolveBaseUrl(): string {
  if (typeof window === "undefined") return "";
  // Allow override via ?api=... or localStorage for the future split-host case,
  // but only when explicitly enabled (closes a token-exfil class).
  const allowOverride = window.localStorage?.getItem(AUTH_OVERRIDE_KEY) === "1";
  if (allowOverride) {
    const fromQuery = new URLSearchParams(window.location.search).get("api");
    if (fromQuery) return fromQuery.replace(/\/+$/, "");
    const fromStorage = window.localStorage?.getItem("ODDJOB_API_BASE");
    if (fromStorage) return fromStorage.replace(/\/+$/, "");
  }
  return window.location.origin;
}

export const baseUrl = resolveBaseUrl();

/**
 * Build an api client. We construct it eagerly with the current token and
 * provide `setBearerToken` so callers can update + re-fetch (the existing
 * client closes over the original; a Proxy would be heavier).
 */
function build(): OddjobApi {
  return createApi({ baseUrl, bearerToken: getBearerToken() });
}

let _api = build();
export const api: OddjobApi = new Proxy({} as OddjobApi, {
  get(_, prop) {
    return (_api as unknown as Record<string | symbol, unknown>)[prop as never];
  },
}) as OddjobApi;

export function rebuildApi(): void {
  _api = build();
}

export interface AuthRequirement {
  tokenRequired: boolean;
  loopback: boolean;
}

export async function fetchAuthRequirement(): Promise<AuthRequirement> {
  const resp = await fetch(`${baseUrl}/_oddjob/auth`);
  if (!resp.ok) return { tokenRequired: false, loopback: true };
  return (await resp.json()) as AuthRequirement;
}

export async function verifyBearer(token: string): Promise<boolean> {
  const resp = await fetch(`${baseUrl}/_oddjob/auth/verify`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  return resp.ok;
}
