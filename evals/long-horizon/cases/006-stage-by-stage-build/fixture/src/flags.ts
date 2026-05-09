// Stage 1 — implement me.
// See src/flags.test.ts for the contract.
export interface Flags {
  name: string;
  upper: boolean;
}
export function parseFlags(_argv: readonly string[]): Flags {
  throw new Error("not implemented: parseFlags");
}
