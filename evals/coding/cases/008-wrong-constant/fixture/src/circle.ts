// Compute the circumference and area of a circle given its radius.
//
// BUG: PI is hard-coded as `3.14` (off by ~0.0016). Tests assert against
// `Math.PI`-derived values to 6 decimal places, so the imprecise constant
// fails every assertion.
//
// Minimal fix: replace the local PI with `Math.PI` (or use Math.PI inline).
const PI = 3.14;

export function circumference(radius: number): number {
  return 2 * PI * radius;
}

export function area(radius: number): number {
  return PI * radius * radius;
}
