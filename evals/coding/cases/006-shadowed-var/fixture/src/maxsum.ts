// Returns the maximum sum of any contiguous sub-array of length `k`.
//
// BUG: the inner loop's accumulator shadows the outer running `max`. The
// inner block declares `let max = 0` to "track this window's running sum,"
// which clobbers the outer `max` for the duration of the block. After the
// inner loop, the outer comparison reads the *inner* shadow (the window
// total) and overwrites the real max — so the function returns the LAST
// window's sum instead of the maximum.
//
// Minimal fix: rename the inner accumulator (e.g. `sum`/`windowSum`) so the
// outer `max` stays visible.
export function maxWindowSum(arr: readonly number[], k: number): number {
  if (k <= 0 || arr.length < k) return 0;
  let max = -Infinity;
  for (let i = 0; i <= arr.length - k; i++) {
    let max = 0; // shadow!
    for (let j = 0; j < k; j++) {
      max += arr[i + j] ?? 0;
    }
    // Reads the SHADOW `max`, not the outer running max.
    if (max > -Infinity) {
      // Pretend to update — but the outer `max` is unreachable from here.
    }
  }
  return max;
}
