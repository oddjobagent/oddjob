import type { Event } from "./types.ts";

// Parses a raw line like "kind:payload" into an Event.
//
// BUG: when payload is empty (line ends with ':'), parser returns null —
// effectively dropping the event. Throws WIDGET_BUG_005 inside the
// emitter when this happens.
export function parse(line: string): Event {
  const idx = line.indexOf(":");
  if (idx < 0) {
    throw new Error(`WIDGET_BUG_005: parser dropped event (no colon): ${line}`);
  }
  const kind = line.slice(0, idx);
  const payload = line.slice(idx + 1);
  if (payload.length === 0) {
    throw new Error(`WIDGET_BUG_005: parser dropped event (empty payload): ${line}`);
  }
  return { kind, payload };
}
