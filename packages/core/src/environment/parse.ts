import { parse as parseToml } from "smol-toml";
import { z } from "zod";

import type { EnvironmentInput } from "../types/environment.ts";
import { BlueprintParseError } from "../blueprint/errors.ts";

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)?$/;

const PackageManifestSchema = z.strictObject({
  apt: z.array(z.string()).optional(),
  cargo: z.array(z.string()).optional(),
  gem: z.array(z.string()).optional(),
  go: z.array(z.string()).optional(),
  npm: z.array(z.string()).optional(),
  pip: z.array(z.string()).optional(),
});

const NetworkingSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("unrestricted") }),
  z.strictObject({
    type: z.literal("limited"),
    allowed_hosts: z.array(z.string().min(1)).default([]),
    allow_mcp_servers: z.boolean().optional(),
    allow_package_managers: z.boolean().optional(),
  }),
]);

const ConfigSchema = z.strictObject({
  type: z.enum(["cloud", "local"]).default("local"),
  packages: PackageManifestSchema.optional(),
  networking: NetworkingSchema.optional(),
  image: z.string().min(1).optional(),
  working_dir: z.string().min(1).optional(),
});

const EnvironmentRawSchema = z.strictObject({
  id: z.string().regex(ID_PATTERN, "id must be lowercase letters/digits/hyphens, optional ns/name"),
  name: z.string().min(1).optional(),
  description: z.string().min(1).max(500).optional(),
  config: ConfigSchema,
});

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
  const result = EnvironmentRawSchema.safeParse(toml);
  if (!result.success) {
    throw new BlueprintParseError(
      `Environment schema invalid:\n${result.error.issues
        .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n")}`,
      result.error,
    );
  }
  const raw = result.data;
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
    },
  };
}
