import { expect, test } from "bun:test";
import { slugify } from "./slugify.ts";

test("slugify lowercases, collapses runs, trims edges", () => {
  expect(slugify("Hello World")).toBe("hello-world");
  expect(slugify("Hello!!!World")).toBe("hello-world");
  expect(slugify("  spaces  ")).toBe("spaces");
  expect(slugify("---leading---and---trailing---")).toBe("leading-and-trailing");
  expect(slugify("MixedCASE 123")).toBe("mixedcase-123");
});
