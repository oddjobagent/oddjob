// BUG: skips the last partial chunk when arr.length % size !== 0.
// e.g. chunk([1,2,3,4,5], 2) returns [[1,2],[3,4]] (drops [5]).
export function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i + size <= arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
