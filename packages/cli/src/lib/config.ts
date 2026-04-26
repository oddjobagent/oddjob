import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { parse as parseToml, stringify } from "smol-toml";

export const ODDJOB_HOME = process.env.ODDJOB_HOME ?? join(homedir(), ".oddjob");
export const CONFIG_PATH = process.env.ODDJOB_CONFIG ?? join(ODDJOB_HOME, "config.toml");
export const STATE_DB = join(ODDJOB_HOME, "state", "oddjob.db");
export const QUEUE_DB = join(ODDJOB_HOME, "state", "queue.db");
export const SECRETS_DB = join(ODDJOB_HOME, "state", "secrets.db");
export const LOGS_DB = join(ODDJOB_HOME, "state", "logs.db");

export interface ServerConfig {
  host: string;
  port: number;
  max_workers: number;
  bearer_token?: string;
}

export interface OddjobConfig {
  server: ServerConfig;
}

export const DEFAULT_CONFIG: OddjobConfig = {
  server: {
    host: "127.0.0.1",
    port: 7777,
    max_workers: 3,
  },
};

export async function loadConfig(): Promise<OddjobConfig> {
  if (!existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
  const src = await readFile(CONFIG_PATH, "utf8");
  const parsed = parseToml(src) as Record<string, unknown>;
  return { server: { ...DEFAULT_CONFIG.server, ...(parsed.server as object) } };
}

export async function saveConfig(cfg: OddjobConfig): Promise<void> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, stringify(cfg as unknown as Record<string, unknown>));
}

export function serverUrl(cfg: OddjobConfig): string {
  const flag = process.env.ODDJOB_SERVER;
  if (flag) return flag;
  return `http://${cfg.server.host}:${cfg.server.port}`;
}
