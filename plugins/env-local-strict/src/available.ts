/**
 * `which <bin>` via Bun.spawn. Returns true if the binary is on PATH and
 * exits 0. Used by service `available()` checks at startup.
 */
export async function isOnPath(bin: string): Promise<boolean> {
  try {
    const proc = Bun.spawn({
      cmd: ["sh", "-c", `command -v ${shellEscape(bin)}`],
      stdout: "pipe",
      stderr: "ignore",
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

function shellEscape(s: string): string {
  // Allow only [A-Za-z0-9_./-]; for anything else, single-quote and escape.
  if (/^[A-Za-z0-9_./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
