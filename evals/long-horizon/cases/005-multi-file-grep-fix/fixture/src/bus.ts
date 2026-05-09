import type { Event } from "./types.ts";

export class Bus {
  private handlers: Array<(e: Event) => void> = [];
  on(fn: (e: Event) => void): void {
    this.handlers.push(fn);
  }
  emit(e: Event): void {
    for (const h of this.handlers) h(e);
  }
}
