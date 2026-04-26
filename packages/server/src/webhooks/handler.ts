import { createHmac, timingSafeEqual } from "node:crypto";

import type { Runtime } from "../runtime.ts";
import { type Handler, json, notFound, unauthorized } from "../middleware/index.ts";

export const webhook =
  (rt: Runtime): Handler =>
  async (req, ctx) => {
    const namespace = ctx.params.namespace ?? "";
    const name = ctx.params.name ?? "";
    const path = `${namespace}/${name}`;

    // Match the webhook URL against any deployment's webhook trigger.
    // Match priority: explicit trigger.path > deployment name == name > deployment.blueprintId == "<ns>/<name>"
    const all = await rt.state.listDeployments();
    let matched: {
      dep: (typeof all)[number];
      trigger: Extract<(typeof all)[number]["triggers"][number], { type: "webhook" }>;
    } | null = null;
    for (const dep of all) {
      for (const trig of dep.triggers) {
        if (trig.type !== "webhook") continue;
        if (trig.path && trig.path.replace(/^\//, "") === path) {
          matched = { dep, trigger: trig };
          break;
        }
        if (!trig.path && dep.blueprintId === path) {
          matched = { dep, trigger: trig };
          break;
        }
      }
      if (matched) break;
    }
    if (!matched) return notFound(`no webhook deployment matches /webhooks/${path}`);
    const dep = matched.dep;
    const hookTrigger = matched.trigger;

    const auth = hookTrigger.auth;
    const body = await req.text();
    if (auth.kind === "bearer") {
      const expected = await rt.secrets.get(auth.secretRef);
      const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!expected || got !== expected) return unauthorized();
    } else if (auth.kind === "hmac") {
      const expected = await rt.secrets.get(auth.secretRef);
      if (!expected) return unauthorized();
      const sig = req.headers.get(auth.header) ?? "";
      const computed = createHmac(auth.algorithm, expected).update(body).digest("hex");
      if (!sigEq(sig, computed)) return unauthorized();
    }

    let parsedInput: unknown = body;
    try {
      parsedInput = JSON.parse(body);
    } catch {
      /* keep raw text */
    }

    const runId = await rt.queue.enqueue({
      deploymentId: dep.id,
      blueprintId: dep.blueprintId,
      triggeredBy: "webhook",
      input: parsedInput,
    });
    return json({ run_id: runId }, { status: 202 });
  };

function sigEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
