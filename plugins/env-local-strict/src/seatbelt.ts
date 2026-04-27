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
 *   - allows file-read* broadly (programs need /usr/lib + /System/Library
 *     + dynamic /Users/<host>/<bun-runtime> paths that are hard to
 *     enumerate exhaustively), then explicitly DENIES exfil-prone paths:
 *       * /tmp, /private/tmp           (other agents' workdirs)
 *       * /Users, /Library/Keychains   (host operator's home + keys)
 *       * /opt (except /opt/homebrew)  (third-party installed secrets)
 *       * /private/var/db/sudo         (sudoers)
 *       * /private/etc/ssh             (host SSH host-keys)
 *     Then re-allows the workdir + meta inside the deny zones.
 *   - allows file-write ONLY inside <workdir> + <meta>
 *   - allows network-outbound (kernel layer); proxy enforces host policy
 *
 * Seatbelt evaluates rules in order — later rules win. The deny-list is
 * intentionally narrower than a deny-default + positive-allowlist would
 * be; sandbox-exec on macOS is brittle enough that fully enumerating the
 * paths a `sh` startup needs (dyld init, locale data, dynamic /Users
 * paths) leads to silent SIGABRTs. This profile is "block obvious exfil
 * paths" not "minimum read surface". 15h SECURITY.md flags the residual
 * gap explicitly + documents that hard policy lives at the docker /
 * daytona tier.
 */
export function buildSeatbeltProfile(
  workdir: string,
  meta: string,
  _opts: SeatbeltOptions = {},
): string {
  const wd = sbQuote(workdir);
  const md = sbQuote(meta);
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    "(allow process-exec)",
    // Broad file-read* baseline so dyld/locale/init succeed.
    "(allow file-read*)",
    // Exfil-prone paths blocked even though file-read* is broad.
    '(deny file-read* (subpath "/tmp"))',
    '(deny file-read* (subpath "/private/tmp"))',
    '(deny file-read* (subpath "/Users"))',
    '(deny file-read* (subpath "/opt"))',
    '(deny file-read* (subpath "/Library/Keychains"))',
    '(deny file-read* (subpath "/private/var/db/sudo"))',
    '(deny file-read* (subpath "/private/etc/ssh"))',
    '(deny file-read* (subpath "/Volumes"))',
    '(deny file-read* (subpath "/Network"))',
    // Re-allow the runtime paths inside the deny zones.
    `(allow file-read* (subpath ${wd}))`,
    `(allow file-read* (subpath ${md}))`,
    '(allow file-read* (subpath "/opt/homebrew"))',
    // Bun + npm + cache dirs the runtime needs for module resolution.
    // These live under /Users which we just blocked, so re-allow them.
    ...userSubpathAllows(),
    `(allow file-write* (subpath ${wd}))`,
    `(allow file-write* (subpath ${md}))`,
    "(allow file-write-data (literal \"/dev/null\"))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow ipc-posix-shm)",
    "(allow signal (target same-sandbox))",
    "(allow network*)",
  ].join("\n");
}

function userSubpathAllows(): string[] {
  const home = process.env.HOME;
  if (!home) return [];
  return [
    `(allow file-read* (subpath "${home}/.bun"))`,
    `(allow file-read* (subpath "${home}/.npm"))`,
    `(allow file-read* (subpath "${home}/.cache"))`,
    `(allow file-read* (subpath "${home}/Library/Caches"))`,
    `(allow file-read* (subpath "${home}/Library/Application Support"))`,
  ];
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
