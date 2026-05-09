import { describe, expect, test } from "bun:test";

import { CircuitBreaker, withRetry, withRetryAndBreaker } from "./retry.ts";

const noSleep = async () => undefined;

describe("withRetry", () => {
  test("returns immediately on first success", async () => {
    let calls = 0;
    const r = await withRetry(
      async () => {
        calls++;
        return 42;
      },
      { sleep: noSleep },
    );
    expect(r).toBe(42);
    expect(calls).toBe(1);
  });

  test("retries on 529 overloaded", async () => {
    let calls = 0;
    const r = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw Object.assign(new Error("overloaded"), { status: 529 });
        return "ok";
      },
      { tries: 5, sleep: noSleep },
    );
    expect(r).toBe("ok");
    expect(calls).toBe(3);
  });

  test("retries on ECONNRESET (code, no status)", async () => {
    let calls = 0;
    const r = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
        return "ok";
      },
      { tries: 3, sleep: noSleep },
    );
    expect(r).toBe("ok");
    expect(calls).toBe(2);
  });

  test("does NOT retry when toolsFiredInTurn returns true", async () => {
    let calls = 0;
    let firedYet = false;
    await expect(() =>
      withRetry(
        async () => {
          calls++;
          firedYet = true;
          throw Object.assign(new Error("overload"), { status: 529 });
        },
        { tries: 5, sleep: noSleep, toolsFiredInTurn: () => firedYet },
      ),
    ).toThrow();
    expect(calls).toBe(1);
  });

  test("non-retryable error throws after first attempt", async () => {
    let calls = 0;
    await expect(() =>
      withRetry(
        async () => {
          calls++;
          throw Object.assign(new Error("bad request"), { status: 400 });
        },
        { tries: 5, sleep: noSleep },
      ),
    ).toThrow("bad request");
    expect(calls).toBe(1);
  });

  test("exhausts retries and rethrows last error", async () => {
    let calls = 0;
    await expect(() =>
      withRetry(
        async () => {
          calls++;
          throw Object.assign(new Error("503"), { status: 503 });
        },
        { tries: 3, sleep: noSleep },
      ),
    ).toThrow("503");
    expect(calls).toBe(3);
  });

  test("checks .cause for nested status/code", async () => {
    let calls = 0;
    const r = await withRetry(
      async () => {
        calls++;
        if (calls < 2) {
          const inner = Object.assign(new Error("upstream"), { status: 502 });
          throw new Error("wrapper", { cause: inner });
        }
        return "ok";
      },
      { sleep: noSleep },
    );
    expect(r).toBe("ok");
    expect(calls).toBe(2);
  });

  test("retries on message-shape match (no structured fields)", async () => {
    let calls = 0;
    const r = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw new Error("provider 529 overloaded right now");
        return "ok";
      },
      { sleep: noSleep },
    );
    expect(r).toBe("ok");
  });
});

describe("CircuitBreaker", () => {
  test("trips after threshold consecutive same-fingerprint errors", () => {
    const b = new CircuitBreaker({ threshold: 3, cooldownMs: 1000, now: () => 100 });
    expect(b.isOpen()).toBe(false);
    b.recordFailure(Object.assign(new Error("x"), { status: 529 }));
    b.recordFailure(Object.assign(new Error("x"), { status: 529 }));
    expect(b.isOpen()).toBe(false);
    b.recordFailure(Object.assign(new Error("x"), { status: 529 }));
    expect(b.isOpen()).toBe(true);
  });

  test("different errors reset the streak", () => {
    const b = new CircuitBreaker({ threshold: 3, cooldownMs: 1000, now: () => 100 });
    b.recordFailure(Object.assign(new Error("a"), { status: 502 }));
    b.recordFailure(Object.assign(new Error("a"), { status: 502 }));
    b.recordFailure(Object.assign(new Error("b"), { status: 503 }));
    expect(b.isOpen()).toBe(false);
  });

  test("success resets the streak", () => {
    const b = new CircuitBreaker({ threshold: 3, cooldownMs: 1000, now: () => 100 });
    b.recordFailure(Object.assign(new Error("x"), { status: 529 }));
    b.recordFailure(Object.assign(new Error("x"), { status: 529 }));
    b.recordSuccess();
    b.recordFailure(Object.assign(new Error("x"), { status: 529 }));
    expect(b.isOpen()).toBe(false);
  });

  test("guard throws when open with the original error", () => {
    let now = 100;
    const b = new CircuitBreaker({ threshold: 1, cooldownMs: 1000, now: () => now });
    const err = Object.assign(new Error("dead"), { status: 529 });
    b.recordFailure(err);
    expect(b.isOpen()).toBe(true);
    expect(() => b.guard()).toThrow("dead");
    now = 1500;
    expect(b.isOpen()).toBe(false);
  });
});

describe("withRetryAndBreaker", () => {
  test("opens breaker when retries exhaust + propagates", async () => {
    const b = new CircuitBreaker({ threshold: 1, cooldownMs: 1000 });
    let calls = 0;
    await expect(() =>
      withRetryAndBreaker(
        async () => {
          calls++;
          throw Object.assign(new Error("503"), { status: 503 });
        },
        b,
        { tries: 2, sleep: noSleep },
      ),
    ).toThrow("503");
    expect(calls).toBe(2);
    expect(b.isOpen()).toBe(true);
    // Subsequent call fast-fails without invoking fn.
    await expect(() => withRetryAndBreaker(async () => "x", b, { sleep: noSleep })).toThrow();
  });
});
