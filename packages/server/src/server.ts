import * as Auth from "./api/auth.ts";
import * as Blueprints from "./api/blueprints.ts";
import * as Channels from "./api/channels.ts";
import * as Cron from "./api/cron.ts";
import * as Deployments from "./api/deployments.ts";
import * as Engine from "./api/engine.ts";
import * as Runs from "./api/runs.ts";
import * as Secrets from "./api/secrets.ts";
import * as Health from "./api/health.ts";
import {
  type Handler,
  type HandlerContext,
  bearerCheck,
  json,
  notFound,
  serverError,
} from "./middleware/index.ts";
import { dashboardRoutes, type HtmlBundle } from "./dashboard-mount.ts";
import type { Runtime } from "./runtime.ts";
import { webhook } from "./webhooks/handler.ts";
import { WorkerPool } from "./workers/pool.ts";

export interface ServerOptions {
  host: string;
  port: number;
  maxWorkers: number;
  bearerToken?: string;
}

export interface ServerHandle {
  url: string;
  workers: WorkerPool;
  stop(): Promise<void>;
}

export interface StartServerOptions {
  runtime: Runtime;
  /**
   * Optional HTML bundle (from `import dashboard from "./index.html"`) for the
   * web UI. When omitted the server runs headless ("--no-ui").
   */
  dashboard?: HtmlBundle;
}

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]);

function isLoopbackBind(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) && host !== "0.0.0.0";
}

export async function startServer(opts: StartServerOptions): Promise<ServerHandle> {
  const rt = opts.runtime;

  if (!isLoopbackBind(rt.config.host) && !rt.bearerToken) {
    throw new Error(
      `oddjob: refusing to start on non-loopback host '${rt.config.host}' without a bearer token. ` +
        `Set ODDJOB_HOME/config.toml [server] bearer_token, or bind to 127.0.0.1.`,
    );
  }

  const workers = new WorkerPool({ runtime: rt });
  await workers.start();

  const routes: Route[] = buildRoutes(rt, workers);

  // Restore cron triggers for active deployments
  if (rt.scheduler) {
    const deps = await rt.state.listDeployments();
    for (const dep of deps) {
      if (dep.status !== "active") continue;
      for (const trig of dep.triggers) {
        if (trig.type !== "cron") continue;
        await rt.scheduler.schedule(dep.id, trig.schedule, trig.timezone, async () => {
          await rt.queue.enqueue({
            deploymentId: dep.id,
            blueprintId: dep.blueprintId,
            triggeredBy: "cron",
          });
        });
      }
    }
  }

  const spaRoutes = opts.dashboard ? dashboardRoutes(opts.dashboard) : undefined;

  const server = Bun.serve({
    hostname: rt.config.host,
    port: rt.config.port,
    development: process.env.ODDJOB_DEV === "1" ? { hmr: true, console: true } : false,
    routes: spaRoutes as never,
    fetch: async (req) => {
      try {
        const url = new URL(req.url);

        // CORS preflight: respond before auth check (browsers strip Authorization
        // from OPTIONS by design). Mirror Origin/headers/methods, never wildcard
        // when bearer auth is required (cookie/credential safety).
        if (req.method === "OPTIONS") {
          return corsPreflight(req, rt);
        }

        // Bootstrap endpoint — needs to be reachable WITHOUT a token so the
        // dashboard can ask "do I need a token?" before showing a login form.
        if (req.method === "GET" && url.pathname === "/_oddjob/auth") {
          return withCors(
            json({
              tokenRequired: !!rt.bearerToken,
              loopback: isLoopbackBind(rt.config.host),
            }),
            req,
            rt,
          );
        }

        // Token verification helper for the dashboard.
        if (req.method === "POST" && url.pathname === "/_oddjob/auth/verify") {
          if (!rt.bearerToken) {
            return withCors(json({ ok: true }), req, rt);
          }
          const check = bearerCheck(req, rt.bearerToken);
          if (check) return withCors(check, req, rt);
          return withCors(json({ ok: true }), req, rt);
        }

        // Auth decision is based on the bind host (where we listen), NOT the
        // Host header (which a client controls). If we're bound to a non-loopback
        // address we always require a bearer token. If we're bound to loopback
        // and a token is configured, also require it for /api/ calls.
        if (!isLoopbackBind(rt.config.host)) {
          const r = bearerCheck(req, rt.bearerToken);
          if (r) return withCors(r, req, rt);
        } else if (rt.bearerToken && url.pathname.startsWith("/api/")) {
          const r = bearerCheck(req, rt.bearerToken);
          if (r) return withCors(r, req, rt);
        }

        for (const route of routes) {
          if (route.method !== req.method && route.method !== "*") continue;
          const m = url.pathname.match(route.pattern);
          if (!m) continue;
          const params: Record<string, string> = {};
          route.paramNames.forEach((n, i) => {
            params[n] = decodeURIComponent(m[i + 1] ?? "");
          });
          const ctx: HandlerContext = { url, params };
          const resp = await route.handler(req, ctx);
          return withCors(resp, req, rt);
        }

        return withCors(notFound(`no route: ${req.method} ${url.pathname}`), req, rt);
      } catch (err) {
        return serverError(err);
      }
    },
  });

  return {
    url: `http://${server.hostname}:${server.port}`,
    workers,
    async stop() {
      await workers.stop();
      if (rt.scheduler) {
        const scheduled = await rt.scheduler.listScheduled();
        for (const s of scheduled) await rt.scheduler.unschedule(s.deploymentId);
      }
      server.stop(true);
    },
  };
}

function corsHeaders(req: Request, rt: Runtime): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  // Loopback no-token: open. Otherwise mirror the requesting origin and rely on
  // Authorization-bearer (not cookies) to keep things sane. We never use `*`
  // when bearer auth is required because a wildcard origin disallows credentials.
  const allowOrigin = origin;
  return {
    "access-control-allow-origin": allowOrigin,
    "vary": "origin",
    "access-control-allow-credentials": rt.bearerToken ? "true" : "false",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "access-control-allow-headers":
      req.headers.get("access-control-request-headers") ?? "authorization,content-type",
    "access-control-max-age": "600",
  };
}

function withCors(resp: Response, req: Request, rt: Runtime): Response {
  const h = corsHeaders(req, rt);
  if (Object.keys(h).length === 0) return resp;
  const out = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(h)) out.headers.set(k, v);
  return out;
}

function corsPreflight(req: Request, rt: Runtime): Response {
  const headers = corsHeaders(req, rt);
  return new Response(null, { status: 204, headers });
}

function buildRoutes(rt: Runtime, workers: WorkerPool): Route[] {
  const r = (method: string, path: string, h: Handler): Route => {
    const paramNames: string[] = [];
    const pattern = new RegExp(
      "^" +
        path.replace(/:([a-zA-Z_]+)/g, (_, name) => {
          paramNames.push(name);
          return "([^/]+)";
        }) +
        "$",
    );
    return { method, pattern, paramNames, handler: h };
  };

  return [
    r("GET", "/api/v1/health", Health.health(rt)),
    r("GET", "/api/v1/status", Health.status(rt)),

    r("GET", "/api/v1/blueprints", Blueprints.list(rt)),
    r("POST", "/api/v1/blueprints", Blueprints.push(rt)),
    r("GET", "/api/v1/blueprints/:namespace/:name", Blueprints.get(rt)),
    r("DELETE", "/api/v1/blueprints/:namespace/:name", Blueprints.remove(rt)),

    r("GET", "/api/v1/deployments", Deployments.list(rt)),
    r("POST", "/api/v1/deployments", Deployments.create(rt)),
    r("GET", "/api/v1/deployments/:id", Deployments.get(rt)),
    r("PATCH", "/api/v1/deployments/:id", Deployments.update(rt)),
    r("DELETE", "/api/v1/deployments/:id", Deployments.remove(rt)),
    r("POST", "/api/v1/deployments/:id/run", Deployments.trigger(rt)),
    r("POST", "/api/v1/deployments/:id/pause", Deployments.pause(rt)),
    r("POST", "/api/v1/deployments/:id/resume", Deployments.resume(rt)),
    r("POST", "/api/v1/deployments/:id/archive", Deployments.archive(rt)),
    r("POST", "/api/v1/deployments/:id/unarchive", Deployments.unarchive(rt)),
    r("GET", "/api/v1/deployments/:id/next-run", Deployments.nextRun(rt)),

    r("GET", "/api/v1/runs", Runs.list(rt)),
    r("GET", "/api/v1/runs/:id", Runs.get(rt)),
    r("GET", "/api/v1/runs/:id/logs", Runs.logs(rt)),
    r("POST", "/api/v1/runs/:id/cancel", Runs.cancel(rt, workers)),

    r("GET", "/api/v1/secrets", Secrets.list(rt)),
    r("PUT", "/api/v1/secrets/:name", Secrets.set(rt)),
    r("DELETE", "/api/v1/secrets/:name", Secrets.remove(rt)),

    r("GET", "/api/v1/engine", Engine.get(rt)),
    r("PATCH", "/api/v1/engine", Engine.update(rt)),
    r("GET", "/api/v1/engine/tools", Engine.tools()),
    r("GET", "/api/v1/models", Engine.models(rt)),

    r("GET", "/api/v1/channels/types", Channels.types()),
    r("POST", "/api/v1/channels/test", Channels.test(rt)),
    r("GET", "/api/v1/channel-templates", Channels.listTemplates(rt)),
    r("POST", "/api/v1/channel-templates", Channels.upsertTemplate(rt)),
    r("GET", "/api/v1/channel-templates/:name", Channels.getTemplate(rt)),
    r("DELETE", "/api/v1/channel-templates/:name", Channels.deleteTemplate(rt)),

    r("POST", "/api/v1/cron/preview", Cron.preview()),

    r("GET", "/api/v1/auth/connectors", Auth.list(rt)),
    r("GET", "/api/v1/auth/connectors/:connectorId", Auth.status(rt)),
    r("POST", "/api/v1/auth/connectors/initiate", Auth.initiate(rt)),
    r("DELETE", "/api/v1/auth/connectors/:connectorId", Auth.revoke(rt)),

    r("POST", "/webhooks/:namespace/:name", webhook(rt)),
  ];
}
