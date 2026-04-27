import { Cron } from "croner";

import { type Handler, badRequest, json, readJson } from "../middleware/index.ts";

interface PreviewBody {
  schedule: string;
  timezone?: string;
  count?: number;
}

export const preview = (): Handler => async (req) => {
  const body = await readJson<PreviewBody>(req);
  if (!body || !body.schedule) return badRequest("schedule required");
  const count = Math.max(1, Math.min(20, body.count ?? 5));
  let cron: Cron;
  try {
    cron = new Cron(body.schedule, { timezone: body.timezone, paused: true });
  } catch (err) {
    return badRequest(`invalid cron: ${(err as Error).message}`);
  }
  const out: number[] = [];
  let cursor: Date | null = null;
  for (let i = 0; i < count; i++) {
    const next = cron.nextRun(cursor ?? undefined);
    if (!next) break;
    out.push(next.getTime());
    cursor = next;
  }
  return json({ schedule: body.schedule, timezone: body.timezone, nextRuns: out });
};
