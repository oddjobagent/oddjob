import { expect, test } from "bun:test";
import { chunk } from "./chunk.ts";

test("chunk splits into equal-sized groups, last group may be smaller", () => {
  expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  expect(chunk([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  expect(chunk([], 3)).toEqual([]);
  expect(chunk(["a", "b", "c", "d", "e"], 3)).toEqual([["a", "b", "c"], ["d", "e"]]);
});
