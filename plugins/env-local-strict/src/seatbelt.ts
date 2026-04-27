import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  EnvironmentProvider,
  EnvironmentRunConfig,
  EnvironmentSession,
} from "@oddjob/core";

import {
  newWrapperContext,
  WrappedSession,
  type CommandWrapper,
  type WrapperContext,
} from "./wrapped-session.ts";

export interface SeatbeltOptions {
  /**
   * Documented signal for "the runtime is going to inject HTTPS_PROXY".
   * The seatbelt profile itself does not narrow network because Apple's
   * sandbox-exec doesn't accept host-level outbound filters; policy is
   * enforced by the credential-broker proxy at the userspace layer plus
   * CA pinning. See SECURITY.md (15h).
   */
  proxyHost?: string;
}

/**
 * Generate a `.sb` profile that:
 *   - denies everything by default
 *   - allows process-fork + process-exec
 *   - allows file-read* ONLY inside an explicit allowlist of subpaths
 *     (workdir, meta, /usr, /System/Library, /Library/Frameworks, runtime
 *     caches, /opt/homebrew, /private/var/folders, a few /dev literals)
 *   - allows file-write ONLY inside <workdir> + <meta>
 *   - allows network-outbound (kernel layer); proxy enforces host policy
 *
 * Reverses the round-2 "broad-read + deny-list" posture: now the read
 * surface is positive-allowlist (Codex round 3 HIGH). Programs the agent
 * needs (`bash`, `sh`, `bun`, `python3`, `curl`, `git`) live under /usr,
 * /System/Library, /Library/Frameworks, or /opt/homebrew on Mac and load
 * shared libs from those subpaths. Anything else (including /tmp, /opt,
 * mounted volumes, other agents' workdirs) is unreadable.
 */
export function buildSeatbeltProfile(
  workdir: string,
  meta: string,
  _opts: SeatbeltOptions = {},
): string {
  const wd = sbQuote(workdir);
  const md = sbQuote(meta);
  const home = process.env.HOME;
  const lines = [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    "(allow process-exec)",
    // file-read* — explicit allowlist of subpaths the runtime needs.
    `(allow file-read* (subpath ${wd}))`,
    `(allow file-read* (subpath ${md}))`,
    '(allow file-read* (subpath "/usr"))',
    '(allow file-read* (subpath "/System/Library"))',
    '(allow file-read* (subpath "/Library/Frameworks"))',
    '(allow file-read* (subpath "/Library/Apple"))',
    '(allow file-read* (subpath "/private/var/folders"))',
    '(allow file-read* (subpath "/opt/homebrew"))',
    '(allow file-read* (subpath "/private/etc/ssl"))',
    // Specific files programs read on startup. Use literal so we do not
    // accidentally expose siblings.
    '(allow file-read* (literal "/private/etc/resolv.conf"))',
    '(allow file-read* (literal "/private/etc/hosts"))',
    '(allow file-read* (literal "/private/etc/services"))',
    '(allow file-read* (literal "/private/etc/protocols"))',
    '(allow file-read* (literal "/dev/null"))',
    '(allow file-read* (literal "/dev/random"))',
    '(allow file-read* (literal "/dev/urandom"))',
  ];
  if (home) {
    // Bun + npm + cache dirs the runtime needs for module resolution.
    lines.push(`(allow file-read* (subpath "${home}/.bun"))`);
    lines.push(`(allow file-read* (subpath "${home}/.npm"))`);
    lines.push(`(allow file-read* (subpath "${home}/.cache"))`);
    lines.push(`(allow file-read* (subpath "${home}/Library/Caches"))`);
    lines.push(`(allow file-read* (subpath "${home}/Library/Application Support"))`);
  }
  lines.push(
    `(allow file-write* (subpath ${wd}))`,
    `(allow file-write* (subpath ${md}))`,
    "(allow file-write-data (literal \"/dev/null\"))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow ipc-posix-shm)",
    "(allow signal (target same-sandbox))",
    "(allow network*)",
  );
  return lines.join("\n");
}

function sbQuote(p: string): string {
  return `"${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

class SeatbeltWrapper implements CommandWrapper {
  async prepare(ctx: WrapperContext): Promise<void> {
    const proxyHost = ctx.config.egressProxy ? "127.0.0.1" : undefined;
    const profile = buildSeatbeltProfile(ctx.root, ctx.meta, { proxyHost });
    await writeFile(join(ctx.meta, "profile.sb"), profile);
  }

  buildArgv(command: string, ctx: WrapperContext): string[] {
    return ["sandbox-exec", "-f", join(ctx.meta, "profile.sb"), "sh", "-c", command];
  }
}

export class SeatbeltEnvironmentProvider implements EnvironmentProvider {
  readonly name = "env-seatbelt";

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthy(): Promise<boolean> {
    return true;
  }

  async spawn(config: EnvironmentRunConfig): Promise<EnvironmentSession> {
    const ctx = await newWrapperContext(config, "oddjob-sb-", "oddjob-sb-meta-");
    return new WrappedSession(ctx, new SeatbeltWrapper());
  }
}
