import { expect, test } from "bun:test";
import { double } from "./foo.ts";

test("double doubles a number", () => {
  expect(double(2)).toBe(4);
  expect(double(0)).toBe(0);
  expect(double(-3)).toBe(-6);
});
