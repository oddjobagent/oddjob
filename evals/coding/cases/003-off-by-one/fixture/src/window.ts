// Returns the LAST `n` elements of `arr`.
//
// BUG: off-by-one in the slice — uses `arr.length - n + 1` instead of
// `arr.length - n`. So `lastN([1,2,3,4,5], 2)` returns `[4,5]` only by
// accident; `lastN([1,2,3], 3)` returns `[2,3]` (missing the first).
//
// Minimal fix: `arr.slice(arr.length - n)` (or `arr.slice(-n)`).
export function lastN<T>(arr: readonly T[], n: number): T[] {
  if (n <= 0) return [];
  if (n >= arr.length) return arr.slice();
  return arr.slice(arr.length - n + 1);
}
