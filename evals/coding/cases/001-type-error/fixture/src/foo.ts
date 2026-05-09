// double the input number.
// BUG: parameter is typed as `string` but the test passes `number`. Inside,
// `+` is used instead of `*`, so the function adds 2 instead of doubling —
// the test fails on `double(0)` (expected 0, gets 2) and `double(-3)`
// (expected -6, gets -1). Minimal fix: retype `n: number` and use `n * 2`.
export function double(n: string): number {
  return parseInt(n as unknown as string, 10) + 2;
}
