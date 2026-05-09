import { expect, test } from "bun:test";
import { clamp } from "./clamp.ts";

test("clamp restricts n to [lo, hi]", () => {
  expect(clamp(5, 0, 10)).toBe(5);
  expect(clamp(-1, 0, 10)).toBe(0);
  expect(clamp(15, 0, 10)).toBe(10);
  expect(clamp(0, 0, 10)).toBe(0);
  expect(clamp(10, 0, 10)).toBe(10);
});

test("clamp throws when lo > hi", () => {
  expect(() => clamp(5, 10, 0)).toThrow();
});
