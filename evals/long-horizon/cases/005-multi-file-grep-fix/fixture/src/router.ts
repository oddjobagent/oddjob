import type { Event } from "./types.ts";

export function route(e: Event): string {
  return e.kind.toLowerCase();
}
