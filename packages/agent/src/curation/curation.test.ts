import { expect, test } from "bun:test";

import { _resetCuration, loadCuration } from "./index.ts";
import { compactModelsDev, lookupModel, _resetCache } from "./models-dev.ts";
import { isRecommended, loadOverlay, _resetOverlay } from "./overlay.ts";

test("compactModelsDev reduces api.json shape to provider→model→entry", () => {
  const compact = compactModelsDev({
    anthropic: {
      models: {
        "claude-foo": { release_date: "2025-01-01", knowledge: "2024-12", last_updated: "2025-02-01" },
        "claude-bar": { release_date: "2025-03-01" },
      },
    },
    empty: { models: {} },
  });
  expect(compact.anthropic).toBeDefined();
  expect(compact.anthropic!["claude-foo"]).toEqual({ r: "2025-01-01", k: "2024-12", u: "2025-02-01" });
  expect(compact.anthropic!["claude-bar"]).toEqual({ r: "2025-03-01" });
  expect(compact.empty).toBeUndefined();
});

test("lookupModel applies provider alias", () => {
  const snap = { google: { "gemini-x": { r: "2025-05-01" } } };
  expect(lookupModel(snap, "google", "gemini-x")).toEqual({ r: "2025-05-01" });
  expect(lookupModel(snap, "google-antigravity", "gemini-x")).toEqual({ r: "2025-05-01" });
  expect(lookupModel(snap, "google-gemini-cli", "gemini-x")).toEqual({ r: "2025-05-01" });
  expect(lookupModel(snap, "anthropic", "gemini-x")).toBeUndefined();
});

test("loadOverlay parses recommended[] entries", () => {
  _resetOverlay();
  const ov = loadOverlay();
  expect(ov.recommended.size).toBeGreaterThan(0);
  expect(isRecommended(ov, "anthropic", "claude-opus-4-7")).toBe(true);
  expect(isRecommended(ov, "anthropic", "definitely-not-a-real-model")).toBe(false);
});

test("loadCuration enrich() fills releasedAt + recommended without overwriting", async () => {
  _resetCuration();
  _resetCache();
  _resetOverlay();
  const c = await loadCuration();
  // anthropic/claude-opus-4-7 is in the overlay AND the snapshot.
  const e1 = c.enrich("anthropic", "claude-opus-4-7");
  expect(e1.recommended).toBe(true);
  expect(e1.releasedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // unknown model — no enrichment.
  const e2 = c.enrich("anthropic", "claude-not-real");
  expect(e2.recommended).toBeUndefined();
  expect(e2.releasedAt).toBeUndefined();
});
