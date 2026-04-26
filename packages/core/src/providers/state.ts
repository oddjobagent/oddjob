import type { Blueprint } from "../types/blueprint.ts";
import type { Deployment, DeploymentInput } from "../types/deployment.ts";
import type { Run } from "../types/run.ts";
import type { Provider } from "./base.ts";

export interface StateProvider extends Provider {
  getKv(namespace: string, key: string): Promise<unknown | null>;
  setKv(namespace: string, key: string, value: unknown, ttlMs?: number): Promise<void>;
  deleteKv(namespace: string, key: string): Promise<void>;
  listKv(namespace: string, prefix?: string): Promise<string[]>;

  upsertBlueprint(blueprint: Blueprint): Promise<void>;
  getBlueprint(id: string): Promise<Blueprint | null>;
  listBlueprints(): Promise<Blueprint[]>;
  deleteBlueprint(id: string): Promise<void>;

  createDeployment(input: DeploymentInput): Promise<Deployment>;
  getDeployment(id: string): Promise<Deployment | null>;
  getDeploymentByName(name: string): Promise<Deployment | null>;
  listDeployments(): Promise<Deployment[]>;
  updateDeployment(id: string, patch: Partial<Deployment>): Promise<Deployment>;
  deleteDeployment(id: string): Promise<void>;

  createRun(run: Run): Promise<void>;
  getRun(id: string): Promise<Run | null>;
  listRuns(filter?: RunFilter): Promise<Run[]>;
  updateRun(id: string, patch: Partial<Run>): Promise<void>;
}

export interface RunFilter {
  deploymentId?: string;
  status?: Run["status"];
  limit?: number;
  cursor?: string;
}
