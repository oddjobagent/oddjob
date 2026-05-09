import { expect, test } from "bun:test";
import { displayName, type User } from "./user.ts";

test("displayName returns trimmed name when set", () => {
  const u: User = { id: "1", profile: { name: "  Ada Lovelace  " } };
  expect(displayName(u)).toBe("Ada Lovelace");
});

test("displayName returns 'anon' when profile missing", () => {
  const u: User = { id: "2" };
  expect(displayName(u)).toBe("anon");
});

test("displayName returns 'anon' when name missing in profile", () => {
  const u: User = { id: "3", profile: { email: "x@y.z" } };
  expect(displayName(u)).toBe("anon");
});

test("displayName returns 'anon' when name is whitespace only", () => {
  const u: User = { id: "4", profile: { name: "   " } };
  expect(displayName(u)).toBe("anon");
});
