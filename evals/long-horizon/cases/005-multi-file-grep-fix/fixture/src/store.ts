import type { Event } from "./types.ts";

export class Store {
  private events: Event[] = [];
  push(e: Event): void {
    this.events.push(e);
  }
  all(): readonly Event[] {
    return this.events;
  }
}
