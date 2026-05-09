import { expect, test } from "bun:test";
import { incrementInParallel } from "./counter.ts";

test("increments correctly under parallelism", async () => {
  const state = { value: 0 };
  await incrementInParallel(state, 100);
  expect(state.value).toBe(100);
});
