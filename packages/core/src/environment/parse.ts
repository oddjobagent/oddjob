import { parse as parseToml } from "smol-toml";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { type Static, Type } from "typebox";

import type { EnvironmentInput } from "../types/environment.ts";
import { BlueprintParseError } from "../blueprint/errors.ts";

const ID_PATTERN = "^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)?$";
const STRICT = { additionalProperties: false } as const;

const PackageManifestSchema = Type.Object(
  {
    apt: Type.Optional(Type.Array(Type.String())),
    cargo: Type.Optional(Type.Array(Type.String())),
    gem: Type.Optional(Type.Array(Type.String())),
    go: Type.Optional(Type.Array(Type.String())),
    npm: Type.Optional(Type.Array(Type.String())),
    pip: Type.Optional(Type.Array(Type.String())),
  },
  STRICT,
);

const NetworkingSchema = Type.Union([
  Type.Object({ type: Type.Literal("unrestricted") }, STRICT),
  Type.Object(
    {
      type: Type.Literal("limited"),
      allowed_hosts: Type.Array(Type.String({ minLength: 1 }), { default: [] }),
      allow_mcp_servers: Type.Optional(Type.Boolean()),
      allow_package_managers: Type.Optional(Type.Boolean()),
    },
    STRICT,
  ),
]);

const ProviderRefSchema = Type.Object(
  {
    service: Type.String({ minLength: 1 }),
    credential: Type.Optional(Type.String({ minLength: 1 })),
  },
  STRICT,
);

const ResourcesSchema = Type.Object(
  {
    cpu: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    mem_mb: Type.Optional(Type.Integer({ minimum: 1 })),
    disk_mb: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  STRICT,
);

const ConfigSchema = Type.Object(
  {
    type: Type.Union([Type.Literal("cloud"), Type.Literal("local")], { default: "local" }),
    packages: Type.Optional(PackageManifestSchema),
    networking: Type.Optional(NetworkingSchema),
    image: Type.Optional(Type.String({ minLength: 1 })),
    working_dir: Type.Optional(Type.String({ minLength: 1 })),
    provider: Type.Optional(ProviderRefSchema),
    resources: Type.Optional(ResourcesSchema),
    template: Type.Optional(Type.String({ minLength: 1 })),
  },
  STRICT,
);

const EnvironmentRawSchema = Type.Object(
  {
    id: Type.String({ pattern: ID_PATTERN }),
    name: Type.Optional(Type.String({ minLength: 1 })),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    config: ConfigSchema,
  },
  STRICT,
);

type EnvironmentRaw = Static<typeof EnvironmentRawSchema>;

const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: false });
addFormats(ajv);
const validate: ValidateFunction = ajv.compile(EnvironmentRawSchema);

function pointerToPath(pointer: string): string {
  if (!pointer || pointer === "/") return "";
  return pointer
    .replace(/^\//, "")
    .split("/")
    .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"))
    .join(".");
}

export function parseEnvironment(source: string): EnvironmentInput {
  let toml: unknown;
  try {
    toml = parseToml(source);
  } catch (err) {
    throw new BlueprintParseError(
      `Failed to parse environment TOML: ${(err as Error).message}`,
      err,
    );
  }
  const data = toml && typeof toml === "object" ? structuredClone(toml) : toml;
  const ok = validate(data);
  if (!ok) {
    const issues = (validate.errors ?? []).map((e) => {
      const extra = (e.params as { additionalProperty?: string } | undefined)?.additionalProperty;
      const message = extra ? `Unrecognized key '${extra}'` : (e.message ?? "invalid");
      return `  - ${pointerToPath(e.instancePath) || "(root)"}: ${message}`;
    });
    throw new BlueprintParseError(`Environment schema invalid:\n${issues.join("\n")}`);
  }
  const raw = data as EnvironmentRaw;
  const networking = raw.config.networking
    ? raw.config.networking.type === "unrestricted"
      ? { type: "unrestricted" as const }
      : {
          type: "limited" as const,
          allowedHosts: raw.config.networking.allowed_hosts,
          allowMcpServers: raw.config.networking.allow_mcp_servers,
          allowPackageManagers: raw.config.networking.allow_package_managers,
        }
    : undefined;

  const resources = raw.config.resources
    ? {
        cpu: raw.config.resources.cpu,
        memMb: raw.config.resources.mem_mb,
        diskMb: raw.config.resources.disk_mb,
      }
    : undefined;
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    config: {
      type: raw.config.type,
      packages: raw.config.packages,
      networking,
      image: raw.config.image,
      workingDir: raw.config.working_dir,
      provider: raw.config.provider,
      resources,
      template: raw.config.template,
    },
  };
}
