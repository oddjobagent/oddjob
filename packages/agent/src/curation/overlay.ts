// Hand-curated editorial flags. Today: a single `recommended` set keyed by
// `${provider}:${modelId}`. Edit `models-overlay.toml` to adjust the lineup;
// validation runs on boot and warns on entries that don't resolve in pi-ai's
// registry.

import { parse as parseToml } from "smol-toml";

import overlayText from "./models-overlay.toml" with { type: "text" };

interface OverlayDoc {
  recommended?: Array<{ provider: string; modelId: string }>;
}

/** Lookup keys are `${provider}:${modelId}`. */
export type RecommendedSet = ReadonlySet<string>;

export interface Overlay {
  recommended: RecommendedSet;
}

function key(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

let memoized: Overlay | undefined;

export function loadOverlay(): Overlay {
  if (memoized) return memoized;
  const parsed = parseToml(overlayText) as OverlayDoc;
  const recommended = new Set<string>();
  for (const entry of parsed.recommended ?? []) {
    if (typeof entry.provider === "string" && typeof entry.modelId === "string") {
      recommended.add(key(entry.provider, entry.modelId));
    }
  }
  memoized = { recommended };
  return memoized;
}

export function isRecommended(o: Overlay, provider: string, modelId: string): boolean {
  return o.recommended.has(key(provider, modelId));
}

/** For tests. */
export function _resetOverlay(): void {
  memoized = undefined;
}
