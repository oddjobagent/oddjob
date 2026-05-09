// Stage 2 — implement me.
// See src/config.test.ts.
export interface Config {
  greeting: string;
}
export async function loadConfig(_path: string): Promise<Config> {
  throw new Error("not implemented: loadConfig");
}
