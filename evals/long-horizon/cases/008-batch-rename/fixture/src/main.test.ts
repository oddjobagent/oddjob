import { expect, test } from "bun:test";
import { fetchUser } from "./api.ts";
import { main } from "./main.ts";

test("api exports fetchUser (renamed from getUser)", async () => {
  const u = await fetchUser("42");
  expect(u).toEqual({ id: "42", name: "user-42" });
});

test("main composes the renamed fetchUser through the call graph", async () => {
  const out = await main("7");
  expect(out).toContain("user-7");
});
