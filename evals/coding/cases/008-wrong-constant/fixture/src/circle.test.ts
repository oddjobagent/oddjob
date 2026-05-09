import { expect, test } from "bun:test";
import { area, circumference } from "./circle.ts";

test("circumference uses Math.PI to 6 decimal places", () => {
  expect(circumference(1)).toBeCloseTo(2 * Math.PI, 6);
  expect(circumference(2.5)).toBeCloseTo(2 * Math.PI * 2.5, 6);
  expect(circumference(10)).toBeCloseTo(20 * Math.PI, 6);
});

test("area uses Math.PI to 6 decimal places", () => {
  expect(area(1)).toBeCloseTo(Math.PI, 6);
  expect(area(3)).toBeCloseTo(9 * Math.PI, 6);
  expect(area(0)).toBe(0);
});
