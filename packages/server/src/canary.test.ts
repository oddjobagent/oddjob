import { describe, expect, test } from "bun:test";

import { startServer } from "./server.ts";

describe("@oddjob/server canary", () => {
  test("startServer is exported", () => {
    expect(typeof startServer).toBe("function");
  });
});
