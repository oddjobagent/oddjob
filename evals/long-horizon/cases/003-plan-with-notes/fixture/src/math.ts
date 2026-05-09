// Three independent functions, each with one bug.
//
// BUG 1: `square` returns n + n instead of n * n.
// BUG 2: `cube` is missing entirely (test imports it; not exported).
// BUG 3: `factorial` recurses forever on n=0 (returns factorial(-1)).

export function square(n: number): number {
  return n + n;
}

export function factorial(n: number): number {
  return n * factorial(n - 1);
}
