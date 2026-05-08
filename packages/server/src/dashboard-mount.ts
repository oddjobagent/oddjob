/**
 * Dashboard mount helpers.
 *
 * The web UI is decoupled from the daemon by design: the dashboard is just an
 * HTTP client of /api/v1/*. This module is the only place where the server
 * knows the dashboard exists. To run headless ("--no-ui"), simply skip the
 * `dashboard` field on StartServerOptions and these routes are not registered.
 *
 * Future split: when the dashboard moves to its own static host, delete the
 * import + caller; the API server doesn't change.
 */

// HTML bundles imported by Bun are an opaque object Bun.serve knows how to
// bundle + serve. We model it as `unknown` to avoid leaking Bun types into
// the public API.
export type HtmlBundle = unknown;

const SPA_PATHS: readonly string[] = [
  "/",
  "/dashboard",
  "/runs",
  "/runs/:id",
  "/deployments",
  "/deployments/new",
  "/deployments/:id",
  "/deployments/:id/edit",
  "/deployments/:id/environment",
  "/blueprints",
  "/blueprints/:namespace",
  "/blueprints/:namespace/:name",
  "/channels",
  "/environments",
  "/environments/providers",
  "/models",
  "/integrations",
  "/settings",
  // Old paths kept as redirects (router.ts handles the redirect at runtime)
  "/providers",
  "/mcp",
  "/plugins",
  "/engine",
  "/secrets",
];

export function dashboardRoutes(html: HtmlBundle): Record<string, HtmlBundle> {
  const out: Record<string, HtmlBundle> = {};
  for (const p of SPA_PATHS) out[p] = html;
  return out;
}

export const DASHBOARD_PATHS = SPA_PATHS;
