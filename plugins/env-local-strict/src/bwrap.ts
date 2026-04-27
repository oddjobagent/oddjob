import type { EnvironmentProvider, EnvironmentRunConfig, EnvironmentSession } from "@oddjob/core";

import {
  newWrapperContext,
  WrappedSession,
  type CommandWrapper,
  type WrapperContext,
} from "./wrapped-session.ts";

/**
 * Build the bubblewrap argv. Strategy (per master plan):
 *   --unshare-all --share-net   network controlled at proxy layer (kernel
 *                               can't usefully filter by host without it)
 *   --ro-bind /usr /usr         libs + binaries read-only
 *   --ro-bind /etc /etc         resolv.conf, ssl certs
 *   --ro-bind-try /lib /lib     libs (32-bit + 64-bit fallthrough)
 *   --ro-bind-try /lib64 /lib64
 *   --ro-bind-try /bin /bin     shells + coreutils
 *   --ro-bind-try /sbin /sbin
 *   --bind <root> <root>        writable workdir
 *   --bind <meta> <meta>        writable per-session meta dir
 *   --proc /proc                fresh procfs
 *   --dev /dev                  minimal devfs
 *   --tmpfs /tmp                isolated /tmp (NOT a host-write hole)
 *   --die-with-parent           kill the sandbox if oddjob crashes
 */
export function buildBwrapArgs(workdir: string, meta: string): string[] {
  return [
    "--die-with-parent",
    "--unshare-all",
    "--share-net",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--ro-bind",
    "/usr",
    "/usr",
    "--ro-bind",
    "/etc",
    "/etc",
    "--ro-bind-try",
    "/lib",
    "/lib",
    "--ro-bind-try",
    "/lib64",
    "/lib64",
    "--ro-bind-try",
    "/bin",
    "/bin",
    "--ro-bind-try",
    "/sbin",
    "/sbin",
    "--bind",
    workdir,
    workdir,
    "--bind",
    meta,
    meta,
    "--chdir",
    workdir,
  ];
}

class BwrapWrapper implements CommandWrapper {
  buildArgv(command: string, ctx: WrapperContext): string[] {
    return ["bwrap", ...buildBwrapArgs(ctx.root, ctx.meta), "sh", "-c", command];
  }
}

export class BwrapEnvironmentProvider implements EnvironmentProvider {
  readonly name = "env-bwrap";

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async healthy(): Promise<boolean> {
    return true;
  }

  async spawn(config: EnvironmentRunConfig): Promise<EnvironmentSession> {
    const ctx = await newWrapperContext(config, "oddjob-bw-", "oddjob-bw-meta-");
    return new WrappedSession(ctx, new BwrapWrapper());
  }
}
