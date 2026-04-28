import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { parse as parseToml, stringify } from "smol-toml";
import Ajv, { type ValidateFunction } from "ajv";
import { Type } from "typebox";

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

export interface BuiltinToolsFileConfig {
  web_search?: {
    /** Web-search plugin slug to dispatch through (preferred). */
    plugin?: string;
    /** @deprecated. Legacy alias for `plugin` (brave/tavily/searxng only). */
    provider?: "brave" | "tavily" | "searxng";
    api_key?: string;
    api_key_secret?: string;
    base_url?: string;
    max_results?: number;
  };
  web_fetch?: {
    /** Web-fetch plugin slug to dispatch through (default: "raw"). */
    plugin?: string;
    api_key?: string;
    api_key_secret?: string;
    max_body_mb?: number;
    private_ips_allowed?: boolean;
    allowlist?: string[];
    blocklist?: string[];
    /** Whether to ask the backend to render JavaScript (browserbase/firecrawl). */
    render_js?: boolean;
  };
}

/** Persisted shape of `[plugins]`. */
export interface PluginsFileConfig {
  /** Plugin slugs to disable at boot. Bundled and local both honor this. */
  disabled?: string[];
}

/** A single credential entry — `[providers.<slug>.<credentialName>]`. */
export interface ProviderCredentialFileConfig {
  api_key_secret?: string;
  options?: Record<string, unknown>;
}

/** A single role assignment — `[roles.<role>]`. */
export interface RoleFileConfig {
  provider: string;
  model: string;
  credential?: string;
  options?: Record<string, unknown>;
}

export interface OddjobConfig {
  server: ServerConfig;
  builtin_tools?: BuiltinToolsFileConfig;
  plugins?: PluginsFileConfig;
  /** providers.<slug>.<credentialName> */
  providers?: Record<string, Record<string, ProviderCredentialFileConfig>>;
  /** roles.<role> */
  roles?: Record<string, RoleFileConfig>;
}

export const DEFAULT_CONFIG: OddjobConfig = {
  server: {
    host: "127.0.0.1",
    port: 7777,
    max_workers: 3,
  },
};

// Schemas only validate the new Phase 17 blocks. Server + builtin_tools are
// passed through as-is for backwards compatibility; they have their own typed
// consumers downstream.
const STRICT = { additionalProperties: false } as const;
const SLUG_PATTERN = "^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$";
const CRED_NAME_PATTERN = "^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$";
const ROLE_PATTERN = "^[a-z][a-z0-9-]*$";

const PluginsSchema = Type.Object(
  {
    disabled: Type.Optional(Type.Array(Type.String({ pattern: SLUG_PATTERN }))),
  },
  STRICT,
);

const ProviderCredentialSchema = Type.Object(
  {
    api_key_secret: Type.Optional(Type.String({ minLength: 1 })),
    options: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  STRICT,
);

// Use raw patternProperties + additionalProperties:false so non-matching
// slugs/credential names are rejected (typebox's Type.Record-with-pattern
// only adds patternProperties without strict-key enforcement).
const ProvidersSchema = Type.Unsafe<
  Record<string, Record<string, ProviderCredentialFileConfig>>
>({
  type: "object",
  patternProperties: {
    [SLUG_PATTERN]: {
      type: "object",
      patternProperties: { [CRED_NAME_PATTERN]: ProviderCredentialSchema },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
});

const RoleSchema = Type.Object(
  {
    provider: Type.String({ pattern: SLUG_PATTERN }),
    model: Type.String({ minLength: 1 }),
    credential: Type.Optional(Type.String({ pattern: CRED_NAME_PATTERN })),
    options: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  STRICT,
);

const RolesSchema = Type.Unsafe<Record<string, RoleFileConfig>>({
  type: "object",
  patternProperties: { [ROLE_PATTERN]: RoleSchema },
  additionalProperties: false,
});

const ajv = new Ajv({ allErrors: true, strict: false });
const validatePlugins: ValidateFunction = ajv.compile(PluginsSchema);
const validateProviders: ValidateFunction = ajv.compile(ProvidersSchema);
const validateRoles: ValidateFunction = ajv.compile(RolesSchema);

function pointerToPath(p: string): string {
  if (!p) return "";
  return p
    .replace(/^\//, "")
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
    .join(".");
}

function formatAjvErrors(prefix: string, errors: ValidateFunction["errors"]): string {
  return (errors ?? [])
    .map((e) => {
      const extra = (e.params as { additionalProperty?: string } | undefined)?.additionalProperty;
      const message = extra ? `Unrecognized key '${extra}'` : (e.message ?? "invalid");
      const path = pointerToPath(e.instancePath);
      return `  - ${prefix}${path ? "." + path : ""}: ${message}`;
    })
    .join("\n");
}

export async function loadConfig(): Promise<OddjobConfig> {
  if (!existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
  let src: string;
  try {
    src = await readFile(CONFIG_PATH, "utf8");
  } catch (err) {
    throw new Error(`oddjob: failed to read ${CONFIG_PATH}: ${(err as Error).message}`);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(src) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `oddjob: ${CONFIG_PATH} is not valid TOML: ${(err as Error).message}\n` +
        `Fix the file or move it aside and let the server scaffold a fresh one.`,
    );
  }
  let plugins: PluginsFileConfig | undefined;
  if (parsed.plugins !== undefined) {
    if (!validatePlugins(parsed.plugins)) {
      throw new Error(
        `oddjob: ${CONFIG_PATH} schema invalid:\n${formatAjvErrors("plugins", validatePlugins.errors)}`,
      );
    }
    plugins = parsed.plugins as PluginsFileConfig;
  }
  let providers: Record<string, Record<string, ProviderCredentialFileConfig>> | undefined;
  if (parsed.providers !== undefined) {
    if (!validateProviders(parsed.providers)) {
      throw new Error(
        `oddjob: ${CONFIG_PATH} schema invalid:\n${formatAjvErrors("providers", validateProviders.errors)}`,
      );
    }
    providers = parsed.providers as Record<string, Record<string, ProviderCredentialFileConfig>>;
  }
  let roles: Record<string, RoleFileConfig> | undefined;
  if (parsed.roles !== undefined) {
    if (!validateRoles(parsed.roles)) {
      throw new Error(
        `oddjob: ${CONFIG_PATH} schema invalid:\n${formatAjvErrors("roles", validateRoles.errors)}`,
      );
    }
    roles = parsed.roles as Record<string, RoleFileConfig>;
  }
  return {
    server: { ...DEFAULT_CONFIG.server, ...(parsed.server as object) },
    builtin_tools: parsed.builtin_tools as BuiltinToolsFileConfig | undefined,
    plugins,
    providers,
    roles,
  };
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
