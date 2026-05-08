// Curation = models.dev join + hand-curated overlay. Single entry point that
// the model-registry calls per model. Keep this fast — it's on a hot listing
// path that powers the dashboard model picker.

import { loadModelsDev, lookupModel, type ModelsDevSnapshot } from "./models-dev.ts";
import { isRecommended, loadOverlay, type Overlay } from "./overlay.ts";

export interface ModelEnrichment {
  releasedAt?: string;
  knowledgeCutoff?: string;
  recommended?: boolean;
}

export interface Curation {
  enrich(providerSlug: string, modelId: string): ModelEnrichment;
}

class CurationImpl implements Curation {
  constructor(
    private readonly mdv: ModelsDevSnapshot,
    private readonly overlay: Overlay,
  ) {}

  enrich(providerSlug: string, modelId: string): ModelEnrichment {
    const out: ModelEnrichment = {};
    const mdvEntry = lookupModel(this.mdv, providerSlug, modelId);
    if (mdvEntry?.r) out.releasedAt = mdvEntry.r;
    if (mdvEntry?.k) out.knowledgeCutoff = mdvEntry.k;
    if (isRecommended(this.overlay, providerSlug, modelId)) out.recommended = true;
    return out;
  }
}

let cached: Promise<Curation> | undefined;

export function loadCuration(): Promise<Curation> {
  if (cached) return cached;
  cached = (async () => {
    const [mdv, overlay] = await Promise.all([loadModelsDev(), Promise.resolve(loadOverlay())]);
    return new CurationImpl(mdv, overlay);
  })();
  return cached;
}

/** For tests. */
export function _resetCuration(): void {
  cached = undefined;
}
