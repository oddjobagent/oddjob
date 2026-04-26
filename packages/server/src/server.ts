import * as Blueprints from "./api/blueprints.ts";
import * as Deployments from "./api/deployments.ts";
import * as Runs from "./api/runs.ts";
import * as Secrets from "./api/secrets.ts";
import * as Health from "./api/health.ts";
import {
  type Handler,
  type HandlerContext,
  badRequest,
  bearerCheck,
  notFound,
  serverError,
  unauthorized,
} from "./middleware/index.ts";
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
}

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

export async function startServer(opts: StartServerOptions): Promise<ServerHandle> {
  const rt = opts.runtime;
  const routes: Route[] = buildRoutes(rt);

  const workers = new WorkerPool({ runtime: rt });
  await workers.start();

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

  const server = Bun.serve({
    hostname: rt.config.host,
    port: rt.config.port,
    fetch: async (req) => {
      try {
        const url = new URL(req.url);

        // Bearer required only when bound to non-localhost
        const isLocalhost = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
        if (!isLocalhost) {
          const r = bearerCheck(req, rt.bearerToken);
          if (r) return r;
        } else if (rt.bearerToken && url.pathname.startsWith("/api/")) {
          const r = bearerCheck(req, rt.bearerToken);
          if (r) return r;
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
          return await route.handler(req, ctx);
        }

        return notFound(`no route: ${req.method} ${url.pathname}`);
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

function buildRoutes(rt: Runtime): Route[] {
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

    r("GET", "/api/v1/runs", Runs.list(rt)),
    r("GET", "/api/v1/runs/:id", Runs.get(rt)),
    r("GET", "/api/v1/runs/:id/logs", Runs.logs(rt)),

    r("GET", "/api/v1/secrets", Secrets.list(rt)),
    r("PUT", "/api/v1/secrets/:name", Secrets.set(rt)),
    r("DELETE", "/api/v1/secrets/:name", Secrets.remove(rt)),

    r("POST", "/webhooks/:namespace/:name", webhook(rt)),
  ];
}
