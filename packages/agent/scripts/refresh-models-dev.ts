#!/usr/bin/env bun
// Fetch models.dev/api.json, compact it against pi-ai's catalog, write the
// snapshot to packages/agent/src/curation/data/models-dev-snapshot.json. Run
// before publishing a release to ship fresh release dates / knowledge cutoffs.
//
// Usage: `bun run refresh:models-dev`

import { getModels, getProviders } from "@mariozechner/pi-ai";

import { compactModelsDev } from "../src/curation/models-dev.ts";

const MODELS_DEV_URL = "https://models.dev/api.json";
const SNAPSHOT_PATH = new URL("../src/curation/data/models-dev-snapshot.json", import.meta.url)
  .pathname;

const ALIAS: Record<string, string> = {
  "azure-openai-responses": "azure",
  fireworks: "fireworks-ai",
  "google-antigravity": "google",
  "google-gemini-cli": "google",
  "kimi-coding": "moonshotai",
  "openai-codex": "openai",
  "vercel-ai-gateway": "vercel",
};

console.error(`fetching ${MODELS_DEV_URL}…`);
const res = await fetch(MODELS_DEV_URL);
if (!res.ok) {
  console.error(`fetch failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const raw = (await res.json()) as Parameters<typeof compactModelsDev>[0];
const fullCompact = compactModelsDev(raw);

// Filter snapshot to only the providers + models we actually serve through pi-ai.
// Cuts size from ~2MB → ~50KB and avoids shipping unrelated provider noise.
const filtered: Record<string, Record<string, unknown>> = {};
let total = 0;
let hits = 0;
for (const provider of getProviders()) {
  const slug = ALIAS[provider] ?? provider;
  const mdvProv = fullCompact[slug];
  if (!mdvProv) continue;
  for (const m of getModels(provider as never)) {
    total++;
    const entry = mdvProv[m.id];
    if (!entry) continue;
    hits++;
    filtered[slug] ??= {};
    filtered[slug][m.id] = entry;
  }
}

const json = JSON.stringify(filtered);
await Bun.write(SNAPSHOT_PATH, json + "\n");
console.error(
  `hit ${hits}/${total} models across ${Object.keys(filtered).length} providers; ${json.length} bytes`,
);
console.error(`wrote ${SNAPSHOT_PATH}`);
