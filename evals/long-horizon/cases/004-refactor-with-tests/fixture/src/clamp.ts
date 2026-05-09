// BUG: clamps to lo even when n > hi (returns lo instead of hi). Also
// silently swallows lo > hi (NaN cases). Tests expect proper clamping
// and a thrown error on invalid bounds.
export function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n < hi) return n;
  return lo;
}
