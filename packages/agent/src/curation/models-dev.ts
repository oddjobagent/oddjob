// models.dev join layer: enriches pi-ai's catalog with releaseDate +
// knowledgeCutoff + lastUpdated by joining on {provider, modelId} against
// https://models.dev/api.json (MIT, no auth). pi-ai is itself auto-generated
// from models.dev — they ship release_date / knowledge / last_updated and pi-ai
// drops them. We re-pick them up here.
//
// Three-tier load:
//   1. cache file ~/.oddjob/cache/models-dev.json if <24h old
//   2. else fetch + write cache
//   3. else (offline / fetch failed) fall back to bundled snapshot
//
// The bundled snapshot is generated at build time by `bun run refresh:models-dev`
// and committed to source. It guarantees offline + first-boot correctness.

import { homedir } from "node:os";
import { join } from "node:path";

import bundled from "./data/models-dev-snapshot.json" with { type: "json" };

/**
 * Single model entry as we serialize it. Keys are short to keep the snapshot
 * compact (730 entries ≈ 52KB).
 */
export interface MdvEntry {
  /** ISO YYYY-MM-DD */
  r?: string;
  /** ISO YYYY-MM */
  k?: string;
  /** ISO last-updated */
  u?: string;
}

/** Map of provider → modelId → entry. */
export type ModelsDevSnapshot = Record<string, Record<string, MdvEntry>>;

/**
 * Provider-slug aliases: pi-ai uses some slugs that don't exist in models.dev.
 * Mapping here lets us still join against the right upstream.
 */
const PROVIDER_ALIAS: Record<string, string> = {
  "azure-openai-responses": "azure",
  fireworks: "fireworks-ai",
  "google-antigravity": "google",
  "google-gemini-cli": "google",
  "kimi-coding": "moonshotai",
  "openai-codex": "openai",
  "vercel-ai-gateway": "vercel",
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MODELS_DEV_URL = "https://models.dev/api.json";

function cachePath(): string {
  return join(homedir(), ".oddjob", "cache", "models-dev.json");
}

async function readCache(): Promise<ModelsDevSnapshot | undefined> {
  try {
    const file = Bun.file(cachePath());
    if (!(await file.exists())) return undefined;
    const stat = await file.stat();
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > CACHE_TTL_MS) return undefined;
    return (await file.json()) as ModelsDevSnapshot;
  } catch {
    return undefined;
  }
}

async function writeCache(data: ModelsDevSnapshot): Promise<void> {
  try {
    await Bun.write(cachePath(), JSON.stringify(data));
  } catch {
    // Best effort — failing to cache must not break startup.
  }
}

/**
 * Reduce models.dev's full api.json into the compact `provider → modelId →
 * MdvEntry` shape we ship. Pure — given the same input, returns the same output.
 */
export function compactModelsDev(
  raw: Record<string, { models: Record<string, Record<string, unknown>> }>,
): ModelsDevSnapshot {
  const out: ModelsDevSnapshot = {};
  for (const [providerSlug, providerData] of Object.entries(raw)) {
    const models = providerData.models;
    if (!models) continue;
    const compacted: Record<string, MdvEntry> = {};
    for (const [modelId, m] of Object.entries(models)) {
      const rec: MdvEntry = {};
      if (typeof m.release_date === "string") rec.r = m.release_date;
      if (typeof m.knowledge === "string") rec.k = m.knowledge;
      if (typeof m.last_updated === "string") rec.u = m.last_updated;
      if (Object.keys(rec).length > 0) compacted[modelId] = rec;
    }
    if (Object.keys(compacted).length > 0) out[providerSlug] = compacted;
  }
  return out;
}

async function fetchUpstream(): Promise<ModelsDevSnapshot | undefined> {
  try {
    const ac = AbortSignal.timeout(5000);
    const res = await fetch(MODELS_DEV_URL, { signal: ac });
    if (!res.ok) return undefined;
    const raw = (await res.json()) as Parameters<typeof compactModelsDev>[0];
    return compactModelsDev(raw);
  } catch {
    return undefined;
  }
}

let cached: Promise<ModelsDevSnapshot> | undefined;

/**
 * Returns the merged models.dev map. Memoized for the process lifetime — callers
 * should treat the result as immutable. Restart the server to pick up a refresh
 * (or run `bun run refresh:models-dev` to regenerate the bundled snapshot).
 */
export function loadModelsDev(): Promise<ModelsDevSnapshot> {
  if (cached) return cached;
  cached = (async () => {
    const fromCache = await readCache();
    if (fromCache) return fromCache;
    const fromNetwork = await fetchUpstream();
    if (fromNetwork) {
      void writeCache(fromNetwork);
      return fromNetwork;
    }
    return bundled as ModelsDevSnapshot;
  })();
  return cached;
}

/**
 * Resolve {pi-ai provider, modelId} → models.dev entry, applying the alias map.
 * Returns undefined if no match.
 */
export function lookupModel(
  snapshot: ModelsDevSnapshot,
  providerSlug: string,
  modelId: string,
): MdvEntry | undefined {
  const directHit = snapshot[providerSlug]?.[modelId];
  if (directHit) return directHit;
  const aliased = PROVIDER_ALIAS[providerSlug];
  if (aliased) return snapshot[aliased]?.[modelId];
  return undefined;
}

/** For tests. */
export function _resetCache(): void {
  cached = undefined;
}
