// BUG: `parseFloat` is referenced but the file lives in a strict-mode TS
// project that exports a helper which mistakenly assumes `parseFloat` is
// available without import. In Bun + bun-types this *is* a global, but the
// helper also calls `nonExistentHelper` from "./helpers.ts" which doesn't
// exist (file is intentionally missing). Test fails to load.
//
// Minimal fix: create `helpers.ts` exporting `nonExistentHelper(s: string):
// number` that returns `Number(s)`, OR remove the import and inline.

import { nonExistentHelper } from "./helpers.ts";

export function sum(values: string[]): number {
  let total = 0;
  for (const v of values) {
    total += nonExistentHelper(v);
  }
  return total;
}
