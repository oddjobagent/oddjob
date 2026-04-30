import { describe, expect, test } from "bun:test";

import { createWebFetchTool } from "./web_fetch.ts";

describe("web_fetch dispatcher", () => {
  test("refuses private IPs at the SSRF guard layer (no registry needed)", async () => {
    const tool = createWebFetchTool();
    const r = await tool.execute("c1", { url: "http://127.0.0.1/" }, undefined);
    expect(r.details.status).toBe(0);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text.toLowerCase()).toMatch(/private|loopback|blocked/);
  });

  test("errors when no plugin registry is supplied", async () => {
    const tool = createWebFetchTool();
    const r = await tool.execute("c1", { url: "https://1.1.1.1/" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("plugin registry unavailable");
  });

  // The SSRF guard runs first and does a real DNS lookup. To exercise the
  // env-egress gate in isolation we use literal-IP URLs (the SSRF guard
  // skips DNS for those) and pass `privateIpsAllowed` only when targeting
  // an RFC1918 / loopback IP we want to avoid hitting.

  test("env allowlist excludes the URL host -> rejected before dispatch", async () => {
    const tool = createWebFetchTool({
      envAllowedHosts: ["1.1.1.1"],
      engineRequiredHosts: [],
    });
    const r = await tool.execute("c1", { url: "https://8.8.8.8/page" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("not in env egress allowlist");
    expect(text).toContain("8.8.8.8");
    expect(r.details.status).toBe(0);
  });

  test("env allowlist permits matching host -> proceeds past gate", async () => {
    const tool = createWebFetchTool({
      envAllowedHosts: ["8.8.8.8"],
      engineRequiredHosts: [],
    });
    const r = await tool.execute("c1", { url: "https://8.8.8.8/page" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    // No registry supplied, so once it passes the env gate it should fail at
    // the next layer (registry) — this proves the gate didn't reject it.
    expect(text).not.toContain("not in env egress allowlist");
    expect(text).toContain("plugin registry unavailable");
  });

  test("engineRequiredHosts is permitted alongside envAllowedHosts", async () => {
    const tool = createWebFetchTool({
      envAllowedHosts: ["1.1.1.1"],
      engineRequiredHosts: ["8.8.8.8"],
    });
    const r = await tool.execute("c1", { url: "https://8.8.8.8/" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).not.toContain("not in env egress allowlist");
    expect(text).toContain("plugin registry unavailable");
  });

  test("undefined envAllowedHosts disables the gate (open networking)", async () => {
    const tool = createWebFetchTool({
      // envAllowedHosts undefined => no gate
      engineRequiredHosts: [],
    });
    const r = await tool.execute("c1", { url: "https://9.9.9.9/" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).not.toContain("not in env egress allowlist");
  });

  test("dispatcher passes a per-hop validateUrl to the fetch service", async () => {
    // Stub registry whose fetch service captures the validateUrl callback.
    let capturedValidator: ((url: string) => Promise<void>) | undefined;
    const registry = stubFetchRegistry({
      supportsRedirectValidation: true,
      impl: (url, _cred, opts) => {
        capturedValidator = opts?.validateUrl;
        return {
          finalUrl: url,
          status: 200,
          body: "",
          format: "text",
          truncated: false,
        };
      },
    });
    const tool = createWebFetchTool({
      envAllowedHosts: ["8.8.8.8"],
      engineRequiredHosts: [],
      plugins: registry,
    });
    await tool.execute("c1", { url: "https://8.8.8.8/" }, undefined);
    expect(typeof capturedValidator).toBe("function");
    // The validator must REJECT a redirect target outside the env allowlist.
    let rejected: unknown;
    try {
      await capturedValidator!("https://1.2.3.4/redirect");
    } catch (err) {
      rejected = err;
    }
    expect(rejected).toBeDefined();
    expect(String((rejected as Error).message)).toContain("not in env egress allowlist");
    // ...and must REJECT a private-IP redirect target (SSRF re-check).
    rejected = undefined;
    try {
      await capturedValidator!("http://169.254.169.254/latest/meta-data/");
    } catch (err) {
      rejected = err;
    }
    expect(rejected).toBeDefined();
    // ...but PERMIT a target inside the allowlist.
    await capturedValidator!("https://8.8.8.8/another-page");
  });

  test("refuses backend with supportsRedirectValidation=false in limited-networking env", async () => {
    // Mirrors the real-world case: agent uses `web_fetch` with `[builtin_tools.web_fetch] plugin = "browserbase"`
    // under a `networking.type = "limited"` env. The dispatcher MUST refuse
    // because the managed scraper can't enforce per-hop validation.
    let invoked = false;
    const registry = stubFetchRegistry({
      supportsRedirectValidation: false, // browserbase / firecrawl / scrapingbee
      impl: (url) => {
        invoked = true;
        return { finalUrl: url, status: 200, body: "", format: "text", truncated: false };
      },
    });
    const tool = createWebFetchTool({
      envAllowedHosts: ["8.8.8.8"],
      engineRequiredHosts: [],
      plugins: registry,
    });
    const r = await tool.execute("c1", { url: "https://8.8.8.8/" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("cannot enforce redirect validation");
    expect(invoked).toBe(false); // backend was never called
  });

  test("permits supportsRedirectValidation=false backend when env is open", async () => {
    let invoked = false;
    const registry = stubFetchRegistry({
      supportsRedirectValidation: false,
      impl: (url) => {
        invoked = true;
        return { finalUrl: url, status: 200, body: "ok", format: "text", truncated: false };
      },
    });
    const tool = createWebFetchTool({
      // envAllowedHosts undefined => no env gate
      engineRequiredHosts: [],
      plugins: registry,
    });
    const r = await tool.execute("c1", { url: "https://8.8.8.8/" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).not.toContain("cannot enforce redirect validation");
    expect(invoked).toBe(true);
    expect(r.details.status).toBe(200);
  });

  test("rejects when the backend's finalUrl lands outside the env allowlist (post-hoc check)", async () => {
    // Even with a backend that DOES report supportsRedirectValidation=true,
    // a misbehaving impl might return a finalUrl that wasn't gated. Post-hoc
    // validation catches that.
    const registry = stubFetchRegistry({
      supportsRedirectValidation: true,
      impl: () => ({
        // Initial URL was 8.8.8.8 (allowed); backend "redirected" to
        // 169.254.169.254 server-side without re-validating.
        finalUrl: "http://169.254.169.254/latest/meta-data/",
        status: 200,
        body: "<metadata>",
        format: "text",
        truncated: false,
      }),
    });
    const tool = createWebFetchTool({
      envAllowedHosts: ["8.8.8.8"],
      engineRequiredHosts: [],
      plugins: registry,
    });
    const r = await tool.execute("c1", { url: "https://8.8.8.8/" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).toContain("final URL rejected after fetch");
    expect(r.details.status).toBe(0); // body suppressed
  });

  test("post-hoc check no-ops when finalUrl matches the initial URL", async () => {
    const registry = stubFetchRegistry({
      supportsRedirectValidation: true,
      impl: (url) => ({
        finalUrl: url,
        status: 200,
        body: "ok",
        format: "text",
        truncated: false,
      }),
    });
    const tool = createWebFetchTool({
      envAllowedHosts: ["8.8.8.8"],
      engineRequiredHosts: [],
      plugins: registry,
    });
    const r = await tool.execute("c1", { url: "https://8.8.8.8/" }, undefined);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text).not.toContain("final URL rejected");
    expect(r.details.status).toBe(200);
  });
});

// ---- helpers ----

import type { PluginRegistry } from "@oddjob/core";
import type {
  ProviderCredential,
  WebFetchOptions,
  WebFetchResult,
  WebFetchService,
} from "@oddjob/core";

interface StubFetchRegistryOpts {
  impl: (
    url: string,
    cred: ProviderCredential,
    opts?: WebFetchOptions,
  ) => WebFetchResult | Promise<WebFetchResult>;
  supportsRedirectValidation?: boolean;
}

function stubFetchRegistry(opts: StubFetchRegistryOpts): PluginRegistry {
  const svc: WebFetchService = {
    kind: "web-fetch",
    id: "raw",
    displayName: "raw",
    supportsRedirectValidation: opts.supportsRedirectValidation,
    async fetch(url, cred, fopts) {
      return await opts.impl(url, cred, fopts);
    },
  };
  return {
    webFetchFor: (id: string) => (id === "raw" ? svc : undefined),
  } as unknown as PluginRegistry;
}
