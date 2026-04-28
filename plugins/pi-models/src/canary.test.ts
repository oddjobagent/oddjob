import { describe, expect, test } from "bun:test";

import plugin from "./index.ts";

describe("pi-models canary", () => {
  test("registers ~25 ModelProviderServices covering pi-ai's known providers", () => {
    const providers = plugin.services
      .filter((s) => s.kind === "model-provider")
      .map((s) => (s.kind === "model-provider" ? s.id : ""));
    // Spot-check a handful of well-known providers.
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
    expect(providers).toContain("openrouter");
    expect(providers).toContain("google");
    expect(providers).toContain("mistral");
    expect(providers).toContain("groq");
    // 25+ providers total (pi-ai 0.70.x ships 25).
    expect(providers.length).toBeGreaterThanOrEqual(20);
  });

  test("anthropic listModels returns at least one Claude model with cost data", () => {
    const svc = plugin.services.find((s) => s.kind === "model-provider" && s.id === "anthropic");
    if (!svc || svc.kind !== "model-provider") throw new Error("anthropic missing");
    const models = svc.listModels();
    expect(models.length).toBeGreaterThan(0);
    const claudeOpus = models.find((m) => m.id.includes("opus"));
    expect(claudeOpus).toBeDefined();
    if (claudeOpus) {
      expect(claudeOpus.contextWindow).toBeGreaterThan(0);
      expect(claudeOpus.inputCostPerMillion).toBeGreaterThan(0);
    }
  });

  test("anthropic createClient resolves a known model from pi-ai's registry", () => {
    const svc = plugin.services.find((s) => s.kind === "model-provider" && s.id === "anthropic");
    if (!svc || svc.kind !== "model-provider") throw new Error("anthropic missing");
    const known = svc.listModels()[0];
    if (!known) throw new Error("no anthropic models");
    const r = svc.createClient(known.id, { apiKey: "test-key" });
    expect(r.model.provider).toBe("anthropic");
    expect(r.model.id).toBe(known.id);
    expect(r.apiKey).toBe("test-key");
  });

  test("openrouter createClient synthesises arbitrary vendor/model passthrough", () => {
    const svc = plugin.services.find((s) => s.kind === "model-provider" && s.id === "openrouter");
    if (!svc || svc.kind !== "model-provider") throw new Error("openrouter missing");
    // A made-up passthrough id that isn't in pi-ai's bundled list.
    const r = svc.createClient("acme-labs/totally-fake-model-2026", { apiKey: "k" });
    expect(r.model.provider).toBe("openrouter");
    expect(r.model.id).toBe("acme-labs/totally-fake-model-2026");
    // OpenRouter is openai-completions per pi-ai's exemplar.
    expect(r.model.api).toBe("openai-completions");
  });

  test("strict provider rejects unknown model id (not in registry, no custom base)", () => {
    const svc = plugin.services.find((s) => s.kind === "model-provider" && s.id === "anthropic");
    if (!svc || svc.kind !== "model-provider") throw new Error("anthropic missing");
    expect(() => svc.createClient("totally-unknown-claude", { apiKey: "k" })).toThrow(/no model/);
  });

  test("custom baseUrl on a known model preserves api + overrides baseUrl", () => {
    const svc = plugin.services.find((s) => s.kind === "model-provider" && s.id === "anthropic");
    if (!svc || svc.kind !== "model-provider") throw new Error("anthropic missing");
    const known = svc.listModels()[0];
    if (!known) throw new Error("no anthropic models");
    const r = svc.createClient(known.id, {
      apiKey: "k",
      options: { baseUrl: "https://my-anthropic-proxy.example.com" },
    });
    expect(r.model.baseUrl).toBe("https://my-anthropic-proxy.example.com");
    // Critical: anthropic stays anthropic-messages, not openai-completions.
    expect(r.model.api).toBe("anthropic-messages");
  });

  test("cost conversion preserves pi-ai's per-million values verbatim", () => {
    const svc = plugin.services.find((s) => s.kind === "model-provider" && s.id === "anthropic");
    if (!svc || svc.kind !== "model-provider") throw new Error("anthropic missing");
    const opus = svc.listModels().find((m) => m.id.includes("opus-4-1"));
    if (!opus) throw new Error("expected an opus-4 model");
    // pi-ai bundles claude-opus-4-1 at $15/M input — assert we don't
    // accidentally multiply by 1M (the codex-flagged regression).
    expect(opus.inputCostPerMillion).toBeLessThan(1000);
    expect(opus.inputCostPerMillion).toBeGreaterThan(0);
  });
});
