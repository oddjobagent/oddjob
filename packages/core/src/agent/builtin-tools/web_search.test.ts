import { describe, expect, test } from "bun:test";

import { createWebSearchTool } from "./web_search.ts";

describe("web_search dispatcher", () => {
  test("errors when no plugin is configured", async () => {
    const tool = createWebSearchTool();
    const r = await tool.execute("c1", { query: "anything" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("not configured");
  });

  test("errors when plugin slug doesn't resolve in registry", async () => {
    const tool = createWebSearchTool({
      config: { plugin: "made-up" },
    });
    const r = await tool.execute("c1", { query: "x" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    // Without a registry, dispatcher reports registry unavailable.
    expect(text).toContain("plugin registry unavailable");
  });

  test("env allowlist excludes the search provider host -> rejected", async () => {
    // tavily defaults to api.tavily.com — env allowlist of openai.com only
    // should refuse the search before hitting the network.
    const tool = createWebSearchTool({
      config: { plugin: "tavily" },
      envAllowedHosts: ["openai.com"],
      engineRequiredHosts: [],
      // Stub plugins so dispatcher passes the registry checks and reaches
      // the env gate. We never actually invoke .search().
      plugins: stubRegistry("tavily"),
    });
    const r = await tool.execute("c1", { query: "anything" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("not in env egress allowlist");
    expect(text).toContain("api.tavily.com");
  });

  test("env allowlist that contains the provider host permits the call", async () => {
    let invoked = false;
    const tool = createWebSearchTool({
      config: { plugin: "tavily" },
      envAllowedHosts: ["api.tavily.com"],
      engineRequiredHosts: [],
      plugins: stubRegistry("tavily", () => {
        invoked = true;
        return [];
      }),
    });
    const r = await tool.execute("c1", { query: "x" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).not.toContain("not in env egress allowlist");
    expect(invoked).toBe(true);
    expect(r.details.resultCount).toBe(0);
  });

  test("undefined envAllowedHosts disables the gate", async () => {
    let invoked = false;
    const tool = createWebSearchTool({
      config: { plugin: "tavily" },
      // envAllowedHosts undefined => no gate
      engineRequiredHosts: [],
      plugins: stubRegistry("tavily", () => {
        invoked = true;
        return [];
      }),
    });
    const r = await tool.execute("c1", { query: "x" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).not.toContain("not in env egress allowlist");
    expect(invoked).toBe(true);
  });

  test("unknown slug with no baseUrl => closed-fail (cannot determine egress host)", async () => {
    const tool = createWebSearchTool({
      config: { plugin: "searxng" }, // self-hosted, no default
      envAllowedHosts: ["search.example"],
      engineRequiredHosts: [],
      plugins: stubRegistry("searxng", () => [], () => undefined),
    });
    const r = await tool.execute("c1", { query: "x" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("cannot determine egress host");
  });

  test("custom plugin without resolveHost works when env gate is dormant", async () => {
    // Open networking (envAllowedHosts undefined) — even if the plugin's
    // `resolveHost` returns undefined, the dispatcher must NOT call it and
    // must NOT fail with "cannot determine egress host". The gate only runs
    // when the surrounding env has limited networking.
    let invoked = false;
    const tool = createWebSearchTool({
      config: { plugin: "custom" },
      // envAllowedHosts undefined
      engineRequiredHosts: [],
      plugins: stubRegistry(
        "custom",
        () => {
          invoked = true;
          return [];
        },
        () => undefined,
      ),
    });
    const r = await tool.execute("c1", { query: "x" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).not.toContain("cannot determine egress host");
    expect(invoked).toBe(true);
  });
});

// ---- helpers ----

import type { PluginRegistry } from "../../plugin/registry.ts";
import type { WebSearchService } from "../../plugin/types.ts";

const STUB_DEFAULT_HOST: Record<string, string> = {
  tavily: "api.tavily.com",
  brave: "api.search.brave.com",
  exa: "api.exa.ai",
  serpapi: "serpapi.com",
};

function stubRegistry(
  slug: string,
  searchImpl: () => readonly unknown[] = () => [],
  resolveHost: (cred: unknown) => string | undefined = () => STUB_DEFAULT_HOST[slug],
): PluginRegistry {
  const svc: WebSearchService = {
    kind: "web-search",
    id: slug,
    displayName: slug,
    async search() {
      return searchImpl() as never;
    },
    resolveHost,
  };
  // Minimal duck-typed PluginRegistry — only `webSearchFor` is touched by
  // the dispatcher in the gate-tests. Cast the partial through `unknown` to
  // satisfy the wider interface without rebuilding everything.
  return {
    webSearchFor: (id: string) => (id === slug ? svc : undefined),
  } as unknown as PluginRegistry;
}
