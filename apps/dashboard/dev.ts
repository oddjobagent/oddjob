import dashboard from "./src/index.html";

const port = Number(process.env.PORT ?? "3001");
const apiBase = process.env.ODDJOB_API ?? "http://127.0.0.1:7777";

const server = Bun.serve({
  port,
  development: { hmr: true, console: true },
  routes: {
    // Proxy /api/* to a running oddjob serve so the dashboard works in dev.
    "/api/*": {
      async GET(req) {
        return proxy(req, apiBase);
      },
      async POST(req) {
        return proxy(req, apiBase);
      },
      async PUT(req) {
        return proxy(req, apiBase);
      },
      async PATCH(req) {
        return proxy(req, apiBase);
      },
      async DELETE(req) {
        return proxy(req, apiBase);
      },
    },
    "/*": dashboard,
  },
});

async function proxy(req: Request, target: string): Promise<Response> {
  const url = new URL(req.url);
  const upstream = `${target}${url.pathname}${url.search}`;
  const headers = new Headers(req.headers);
  headers.delete("host");
  return fetch(upstream, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
  });
}

console.log(`oddjob dashboard dev: http://${server.hostname}:${server.port}`);
console.log(`  proxying /api/* -> ${apiBase}`);
