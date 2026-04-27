import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Strict-local environments must NEVER let a bad workdir or absolute path
 * escape the sandbox. These helpers enforce that:
 *   - workdir at session start must be an absolute, existing path that
 *     does NOT resolve (via realpath) to a known-dangerous system root.
 *   - file IO paths are first lexically contained, then realpath()-checked
 *     so a symlink inside the workdir can't redirect writes to /etc/passwd.
 *
 * Functions throw on policy violation. Callers don't catch — they want the
 * session to die loudly rather than silently exfil.
 *
 * Note: we deliberately accept blueprint directories the worker pool hands
 * us (e.g. /Users/<x>/jobs/echo) since those are operator-controlled, not
 * agent-controlled. The policy bar is "no obvious pwn paths" plus "no
 * symlink-out".
 */
const FORBIDDEN_ROOTS = [
  "/",
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/var",
  "/dev",
  "/proc",
  "/sys",
  "/boot",
  "/root",
  "/System",
  "/Library",
  "/Applications",
  "/Network",
  "/Volumes",
  "/Windows",
  "/Program Files",
  "/Program Files (x86)",
  // macOS resolves /etc, /var, /tmp through /private/* — forbid those too
  // so a symlink-traversal can't bypass the check.
  "/private",
  "/private/etc",
  "/private/usr",
  "/private/bin",
  "/private/sbin",
  "/private/var",
  "/private/dev",
];

export async function validateStrictWorkdir(workdir: string): Promise<void> {
  if (!workdir || !isAbsolute(workdir)) {
    throw new Error(
      `env-local-strict: workdir must be an absolute path (got ${JSON.stringify(workdir)})`,
    );
  }
  let real: string;
  try {
    real = await realpath(workdir);
  } catch (err) {
    throw new Error(
      `env-local-strict: workdir does not exist or is not accessible: ${workdir} (${(err as Error).message})`,
    );
  }
  for (const forbidden of FORBIDDEN_ROOTS) {
    if (real === forbidden) {
      throw new Error(`env-local-strict: workdir ${real} is a forbidden system root`);
    }
  }
}

/**
 * Refuse any path that escapes `root`, both lexically AND after symlink
 * resolution. Lexical containment alone is not enough: an agent that can
 * `ln -s /etc <root>/link` would have writeFile("link/passwd") pass the
 * lexical check, then have node:fs follow the symlink and write to /etc.
 *
 * Strategy:
 *   1. Lexical check on the requested path → reject `..` traversal etc.
 *   2. realpath(root) once.
 *   3. realpath(closest existing ancestor of the resolved path) → since
 *      the file may not exist yet for writeFile, we walk up until we find
 *      a real path, realpath it, then ensure that real ancestor is still
 *      under realpath(root).
 *
 * Returns the lexically-resolved absolute path (the one to actually open).
 *
 * TOCTOU note: realpath-then-open is racy on POSIX. A concurrent process
 * inside the workdir can swap a checked path for a symlink between our
 * realpath() and the subsequent fs.open(). Mitigation requires
 * openat(O_NOFOLLOW) at every path component, which Bun's fs API doesn't
 * expose as of Bun 1.3. Tracked in docs/SECURITY.md (15h). For hard
 * isolation against this class, use the docker (network namespace) or
 * daytona (VM) tier — those isolate the entire filesystem, removing the
 * shared-fs race.
 */
export async function resolveInsideStrict(root: string, path: string): Promise<string> {
  if (!path) throw new Error("env-local-strict: empty path");
  const abs = isAbsolute(path) ? path : resolve(root, path);
  const lexicalRel = relative(root, abs);
  if (
    lexicalRel === "" ||
    lexicalRel.startsWith("..") ||
    isAbsolute(lexicalRel) ||
    lexicalRel.split(sep).includes("..")
  ) {
    throw new Error(
      `env-local-strict: refusing path outside workdir: ${path} (resolved ${abs}; root ${root})`,
    );
  }
  const realRoot = await realpath(root);
  const realAncestor = await realpathOfClosestAncestor(abs);
  const realRel = relative(realRoot, realAncestor);
  if (realRel.startsWith("..") || isAbsolute(realRel) || realRel.split(sep).includes("..")) {
    throw new Error(
      `env-local-strict: refusing symlink-escape path: ${path} (lex ${abs}; real ${realAncestor}; root ${realRoot})`,
    );
  }
  return abs;
}

/**
 * Walk up the path until `realpath()` succeeds (i.e. the closest existing
 * ancestor). Needed because writeFile may target a not-yet-existing file
 * but its directory does exist + can be checked for symlink redirection.
 */
async function realpathOfClosestAncestor(p: string): Promise<string> {
  let cur = p;
  // Bound the climb at the FS root.
  for (let i = 0; i < 64; i++) {
    try {
      return await realpath(cur);
    } catch {
      const parent = dirname(cur);
      if (parent === cur) {
        throw new Error(`env-local-strict: cannot realpath any ancestor of ${p}`);
      }
      cur = parent;
    }
  }
  throw new Error(`env-local-strict: too many ancestor lookups for ${p}`);
}
