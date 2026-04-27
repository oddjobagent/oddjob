/**
 * Environment: a reusable container/sandbox configuration shared across
 * blueprints. Today the local `process` EnvironmentProvider ignores most of
 * these (it runs in the host shell), but blueprints opt into them so cloud
 * EnvironmentProviders (Phase 15: E2B / Modal / Daytona) can pre-bake images.
 */
export interface Environment {
  /** Stable identifier, e.g. "data-analysis" or "nineprimes/seo-toolkit". */
  id: string;
  /** Optional friendly name (defaults to id). */
  name?: string;
  description?: string;
  /** Configuration body (CMA-style "cloud" config). */
  config: EnvironmentConfig;
  createdAt: number;
  updatedAt: number;
}

export interface EnvironmentConfig {
  type: "cloud" | "local";
  packages?: PackageManifest;
  networking?: NetworkingConfig;
  /** Optional base container image (cloud sandboxes only). */
  image?: string;
  /** Working directory inside the sandbox; defaults to /work. */
  workingDir?: string;
  /**
   * Which EnvironmentService implements this environment. When omitted the
   * runtime falls back to engine.default_environment_id's provider, then to
   * the platform-appropriate hard default ("seatbelt" / "bwrap" / "process").
   */
  provider?: EnvironmentProviderRef;
  /** Resource caps. Honored by container/remote backends; ignored by local. */
  resources?: EnvironmentResources;
  /** Optional template name (cloud backends with a snapshot/template registry). */
  template?: string;
}

export interface EnvironmentProviderRef {
  /** EnvironmentService.id, e.g. "process" / "seatbelt" / "docker" / "daytona". */
  service: string;
  /** Provider-credential name in the provider_credentials table. Default "default". */
  credential?: string;
}

export interface EnvironmentResources {
  cpu?: number;
  memMb?: number;
  diskMb?: number;
}

export interface PackageManifest {
  apt?: string[];
  cargo?: string[];
  gem?: string[];
  go?: string[];
  npm?: string[];
  pip?: string[];
}

export type NetworkingConfig =
  | { type: "unrestricted" }
  | {
      type: "limited";
      allowedHosts: string[];
      allowMcpServers?: boolean;
      allowPackageManagers?: boolean;
    };

export interface EnvironmentInput {
  id: string;
  name?: string;
  description?: string;
  config: EnvironmentConfig;
}
