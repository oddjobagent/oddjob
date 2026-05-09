// Increment a shared counter `count` times in parallel.
//
// BUG: read-modify-write of `state.value` is non-atomic. Each promise
// reads the snapshot, computes +1, writes back — concurrent writers
// clobber each other and the final value is much less than `count`.
//
// Minimal fix: replace Promise.all of the increments with a sequential
// for-await loop, OR use a single accumulator that doesn't require
// Promise.all to coordinate.

export async function incrementInParallel(
  state: { value: number },
  count: number,
): Promise<void> {
  await Promise.all(
    Array.from({ length: count }, async () => {
      const snapshot = state.value;
      // simulate microtask gap
      await Promise.resolve();
      state.value = snapshot + 1;
    }),
  );
}
