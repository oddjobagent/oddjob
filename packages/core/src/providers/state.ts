import type { Blueprint } from "../types/blueprint.ts";
import type {
  Deployment,
  DeploymentInput,
  DeploymentListFilter,
} from "../types/deployment.ts";
import type { Run } from "../types/run.ts";
import type { Provider } from "./base.ts";

export interface StateProvider extends Provider {
  getKv(namespace: string, key: string): Promise<unknown | null>;
  setKv(namespace: string, key: string, value: unknown, ttlMs?: number): Promise<void>;
  deleteKv(namespace: string, key: string): Promise<void>;
  listKv(namespace: string, prefix?: string): Promise<string[]>;

  /**
   * Push a blueprint as a new immutable version row + bump the `latest` tag.
   * @throws if `(id, version)` already exists and `force` is false.
   */
  upsertBlueprint(blueprint: Blueprint, opts?: UpsertBlueprintOptions): Promise<void>;
  /**
   * Resolve a blueprint by id, optionally pinned to a tag (default `latest`).
   * Pass `version` to bypass tag resolution and load an exact immutable row.
   */
  getBlueprint(id: string, ref?: BlueprintResolveRef): Promise<Blueprint | null>;
  listBlueprints(): Promise<Blueprint[]>;
  deleteBlueprint(id: string): Promise<void>;
  listBlueprintVersions(id: string): Promise<BlueprintVersionRow[]>;
  listBlueprintTags(id: string): Promise<BlueprintTagRow[]>;
  setBlueprintTag(id: string, tag: string, version: string): Promise<void>;
  deleteBlueprintTag(id: string, tag: string): Promise<void>;

  createDeployment(input: DeploymentInput): Promise<Deployment>;
  getDeployment(id: string): Promise<Deployment | null>;
  getDeploymentByName(name: string): Promise<Deployment | null>;
  listDeployments(filter?: DeploymentListFilter): Promise<Deployment[]>;
  updateDeployment(id: string, patch: Partial<Deployment>): Promise<Deployment>;
  deleteDeployment(id: string): Promise<void>;

  createRun(run: Run): Promise<void>;
  getRun(id: string): Promise<Run | null>;
  listRuns(filter?: RunFilter): Promise<Run[]>;
  updateRun(id: string, patch: Partial<Run>): Promise<void>;

  upsertConnectorToken(record: ConnectorTokenRecord): Promise<void>;
  getConnectorToken(connectorId: string): Promise<ConnectorTokenRecord | null>;
  listConnectorTokens(): Promise<ConnectorTokenRecord[]>;
  deleteConnectorToken(connectorId: string): Promise<void>;

  upsertChannelTemplate(template: ChannelTemplate): Promise<void>;
  getChannelTemplate(name: string): Promise<ChannelTemplate | null>;
  listChannelTemplates(): Promise<ChannelTemplate[]>;
  deleteChannelTemplate(name: string): Promise<void>;
}

export interface ChannelTemplate {
  name: string;
  type: string;
  /** ChannelConfig (whichever variant matches `type`) serialized as JSON. */
  config: unknown;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConnectorTokenRecord {
  /** "<deploymentId>:<connectorName>" */
  connectorId: string;
  deploymentId: string;
  connectorName: string;
  /** Encrypted blob — stored as base64 to keep StateProvider browser-safe in types. */
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string;
  expiresAt?: number;
  refreshExpiresAt?: number;
  tokenUrl?: string;
  clientId?: string;
  clientSecretEncrypted?: string;
  scopes?: string;
  status: "active" | "expired" | "reauth_needed" | "revoked";
  updatedAt: number;
}

export interface RunFilter {
  deploymentId?: string;
  status?: Run["status"];
  limit?: number;
  cursor?: string;
}

export interface UpsertBlueprintOptions {
  /** Overwrite an existing (id, version) row. Default false → throws on conflict. */
  force?: boolean;
  /** Additional tags to move to this version (e.g. ["stable", "v1"]). `latest` is always moved. */
  tags?: string[];
}

export interface BlueprintResolveRef {
  /** Tag to look up (default "latest"). Ignored when `version` is set. */
  tag?: string;
  /** Pin to an exact version, bypassing tag resolution. */
  version?: string;
}

export interface BlueprintVersionRow {
  blueprintId: string;
  version: string;
  description: string;
  contentHash: string;
  createdAt: number;
}

export interface BlueprintTagRow {
  blueprintId: string;
  tag: string;
  version: string;
  updatedAt: number;
}

export class BlueprintVersionExistsError extends Error {
  constructor(public readonly blueprintId: string, public readonly version: string) {
    super(`blueprint ${blueprintId}@${version} already exists (use force to overwrite)`);
    this.name = "BlueprintVersionExistsError";
  }
}

export class BlueprintTagNotFoundError extends Error {
  constructor(public readonly blueprintId: string, public readonly tag: string) {
    super(`blueprint ${blueprintId} has no tag '${tag}'`);
    this.name = "BlueprintTagNotFoundError";
  }
}
