import { expect, test } from "bun:test";
import { sum } from "./sum.ts";

test("sums string-encoded numbers", () => {
  expect(sum(["1", "2", "3"])).toBe(6);
  expect(sum([])).toBe(0);
  expect(sum(["1.5", "2.5"])).toBe(4);
});
