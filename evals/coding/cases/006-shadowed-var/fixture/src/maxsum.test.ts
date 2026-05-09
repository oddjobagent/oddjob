import { expect, test } from "bun:test";
import { maxWindowSum } from "./maxsum.ts";

test("maxWindowSum finds the max contiguous sum of length k", () => {
  expect(maxWindowSum([1, 2, 3, 4, 5], 2)).toBe(9);
  expect(maxWindowSum([5, 1, 1, 1, 1], 2)).toBe(6);
  expect(maxWindowSum([2, 2, 2, 2, 2], 3)).toBe(6);
  expect(maxWindowSum([10, -1, -1, -1], 2)).toBe(9);
  expect(maxWindowSum([], 3)).toBe(0);
});
