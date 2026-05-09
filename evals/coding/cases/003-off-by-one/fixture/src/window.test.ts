import { expect, test } from "bun:test";
import { lastN } from "./window.ts";

test("returns the last N elements", () => {
  expect(lastN([1, 2, 3, 4, 5], 2)).toEqual([4, 5]);
  expect(lastN([1, 2, 3], 3)).toEqual([1, 2, 3]);
  expect(lastN(["a", "b", "c", "d"], 1)).toEqual(["d"]);
  expect(lastN([], 5)).toEqual([]);
  expect(lastN([1, 2], 0)).toEqual([]);
});
