import { expect, test } from "bun:test";
import { Bus } from "./bus.ts";
import { parse } from "./parser.ts";
import { Store } from "./store.ts";
import { route } from "./router.ts";

test("parser handles empty payloads", () => {
  expect(parse("ping:")).toEqual({ kind: "ping", payload: "" });
  expect(parse("hello:world")).toEqual({ kind: "hello", payload: "world" });
});

test("end-to-end: bus + parser + router + store", () => {
  const bus = new Bus();
  const store = new Store();
  bus.on((e) => store.push(e));

  const lines = ["ready:", "tick:1", "tick:2", "shutdown:"];
  for (const line of lines) {
    const e = parse(line);
    e.kind = route(e);
    bus.emit(e);
  }

  expect(store.all().length).toBe(4);
  expect(store.all().map((e) => e.kind)).toEqual(["ready", "tick", "tick", "shutdown"]);
});
