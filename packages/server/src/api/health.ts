import type { Runtime } from "../runtime.ts";
import { type Handler, json } from "../middleware/index.ts";

export const health =
  (rt: Runtime): Handler =>
  async () => {
    const [state, queue, secrets] = await Promise.all([
      rt.state.healthy(),
      rt.queue.healthy(),
      rt.secrets.healthy(),
    ]);
    const ok = state && queue && secrets;
    const depth = await rt.queue.depth().catch(() => null);
    return json(
      { ok, providers: { state, queue, secrets }, depth, time: Date.now() },
      { status: ok ? 200 : 503 },
    );
  };

export const status =
  (rt: Runtime): Handler =>
  async () => {
    const [deployments, depth] = await Promise.all([rt.state.listDeployments(), rt.queue.depth()]);
    const scheduled = (await rt.scheduler?.listScheduled()) ?? [];
    return json({
      uptime_ms: process.uptime() * 1000,
      deployments: deployments.length,
      scheduled,
      queue: depth,
      max_workers: rt.config.maxWorkers,
    });
  };
