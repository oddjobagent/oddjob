import { createApi, type OddjobApi } from "@oddjob/api-client";

function readBearerFromMeta(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const meta = document.querySelector('meta[name="x-oddjob-token"]');
  const v = meta?.getAttribute("content");
  return v && v.length > 0 ? v : undefined;
}

function resolveBaseUrl(): string {
  if (typeof window === "undefined") return "";
  // Allow override via ?api=... or localStorage for the future split-host case.
  const fromQuery = new URLSearchParams(window.location.search).get("api");
  if (fromQuery) return fromQuery.replace(/\/+$/, "");
  const fromStorage = window.localStorage?.getItem("ODDJOB_API_BASE");
  if (fromStorage) return fromStorage.replace(/\/+$/, "");
  // Default: same origin (dashboard is mounted on the API server).
  return window.location.origin;
}

export const api: OddjobApi = createApi({
  baseUrl: resolveBaseUrl(),
  bearerToken: readBearerFromMeta(),
});
