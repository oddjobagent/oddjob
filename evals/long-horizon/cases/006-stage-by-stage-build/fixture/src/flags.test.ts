import { expect, test } from "bun:test";
import { parseFlags } from "./flags.ts";

test("parseFlags accepts --name", () => {
  expect(parseFlags(["--name", "Ada"])).toEqual({ name: "Ada", upper: false });
});

test("parseFlags accepts --upper", () => {
  expect(parseFlags(["--name", "Grace", "--upper"])).toEqual({ name: "Grace", upper: true });
});

test("parseFlags throws on missing --name", () => {
  expect(() => parseFlags([])).toThrow();
  expect(() => parseFlags(["--upper"])).toThrow();
});

test("parseFlags throws on --name with no value", () => {
  expect(() => parseFlags(["--name"])).toThrow();
});
