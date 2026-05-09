import { expect, test } from "bun:test";
import { cube, factorial, square } from "./math.ts";

test("square", () => {
  expect(square(0)).toBe(0);
  expect(square(3)).toBe(9);
  expect(square(-4)).toBe(16);
});

test("cube", () => {
  expect(cube(0)).toBe(0);
  expect(cube(2)).toBe(8);
  expect(cube(-3)).toBe(-27);
});

test("factorial", () => {
  expect(factorial(0)).toBe(1);
  expect(factorial(5)).toBe(120);
});
