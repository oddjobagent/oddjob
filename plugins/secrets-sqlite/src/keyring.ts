import { spawn } from "node:child_process";
import { platform } from "node:os";

const SERVICE = "oddjob";
const ACCOUNT = "master-key";

export async function loadOrCreateMasterKey(): Promise<Buffer> {
  const fromEnv = process.env.ODDJOB_MASTER_KEY;
  if (fromEnv) return decodeKey(fromEnv);

  const existing = await readKeyring();
  if (existing) return decodeKey(existing);

  const fresh = randomKey();
  await writeKeyring(fresh);
  return decodeKey(fresh);
}

export function randomKey(): string {
  const buf = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(buf).toString("base64");
}

function decodeKey(s: string): Buffer {
  const buf = Buffer.from(s, "base64");
  if (buf.length !== 32) throw new Error(`master key must be 32 bytes; got ${buf.length}`);
  return buf;
}

async function readKeyring(): Promise<string | null> {
  switch (platform()) {
    case "darwin": {
      const r = await runCmd("security", [
        "find-generic-password",
        "-s",
        SERVICE,
        "-a",
        ACCOUNT,
        "-w",
      ]);
      if (r.code === 0) return r.stdout.trim();
      return null;
    }
    case "linux": {
      const r = await runCmd("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT]);
      if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
      return null;
    }
    default:
      return null;
  }
}

async function writeKeyring(value: string): Promise<void> {
  switch (platform()) {
    case "darwin": {
      const r = await runCmd("security", [
        "add-generic-password",
        "-U",
        "-s",
        SERVICE,
        "-a",
        ACCOUNT,
        "-w",
        value,
      ]);
      if (r.code !== 0) {
        throw new Error(`Failed to write to macOS Keychain: ${r.stderr}`);
      }
      return;
    }
    case "linux": {
      const r = await runCmdStdin(
        "secret-tool",
        ["store", "--label", "Oddjob master key", "service", SERVICE, "account", ACCOUNT],
        value,
      );
      if (r.code !== 0) {
        throw new Error(
          `Failed to write to libsecret: ${r.stderr}. Set ODDJOB_MASTER_KEY env var instead.`,
        );
      }
      return;
    }
    default:
      throw new Error(`No keyring support for ${platform()}. Set ODDJOB_MASTER_KEY env var.`);
  }
}

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCmd(cmd: string, args: string[]): Promise<CmdResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => {
      stdout += b.toString();
    });
    child.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.on("error", () => resolve({ code: -1, stdout, stderr }));
  });
}

async function runCmdStdin(cmd: string, args: string[], stdin: string): Promise<CmdResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => {
      stdout += b.toString();
    });
    child.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.on("error", () => resolve({ code: -1, stdout, stderr }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}
