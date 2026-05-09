// Tests pin the chosen strategy: read-through with TTL (Strategy B).
//
// - .get(k) returns a value, calling loader(k) lazily on miss.
// - subsequent get within ttlMs uses cached value (loader NOT called again).
// - after ttlMs has elapsed (per injected clock), loader is called again.
// - Cache does NOT eagerly populate. .size() is 0 before any get.
import { expect, test } from "bun:test";
import { Cache } from "./cache.ts";

test("Cache lazily loads on miss", async () => {
  let calls = 0;
  const c = new Cache({
    ttlMs: 1000,
    loader: async (k) => {
      calls++;
      return `value:${k}`;
    },
  });
  expect(c.size()).toBe(0);
  expect(await c.get("foo")).toBe("value:foo");
  expect(calls).toBe(1);
  expect(c.size()).toBe(1);
});

test("Cache returns cached value within TTL", async () => {
  let calls = 0;
  let now = 0;
  const c = new Cache({
    ttlMs: 1000,
    loader: async (k) => {
      calls++;
      return `value:${k}-${calls}`;
    },
    now: () => now,
  });
  expect(await c.get("a")).toBe("value:a-1");
  now = 500; // within TTL
  expect(await c.get("a")).toBe("value:a-1"); // cached
  expect(calls).toBe(1);
});

test("Cache reloads after TTL expires", async () => {
  let calls = 0;
  let now = 0;
  const c = new Cache({
    ttlMs: 1000,
    loader: async (k) => {
      calls++;
      return `value:${k}-${calls}`;
    },
    now: () => now,
  });
  expect(await c.get("a")).toBe("value:a-1");
  now = 1500; // expired
  expect(await c.get("a")).toBe("value:a-2"); // reloaded
  expect(calls).toBe(2);
});
