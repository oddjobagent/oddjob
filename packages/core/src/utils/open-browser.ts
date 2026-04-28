export interface OpenBrowserOptions {
  spawnImpl?: typeof Bun.spawn;
}

export async function openBrowser(url: string, opts: OpenBrowserOptions = {}): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`refusing to open invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`refusing to open non-http(s) URL: ${parsed.protocol}`);
  }

  const spawn = opts.spawnImpl ?? Bun.spawn;
  const platform = process.platform;
  let cmd: string[];
  if (platform === "darwin") cmd = ["open", url];
  else if (platform === "win32") cmd = ["cmd", "/c", "start", "", url];
  else cmd = ["xdg-open", url];

  const proc = spawn(cmd, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
  void proc.exited.catch(() => undefined);
}
