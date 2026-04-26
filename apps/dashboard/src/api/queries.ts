import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import type { Blueprint, Deployment, LogEntry, Run } from "@oddjob/core";

import { api } from "./client.ts";

const fast = 1_000;
const med = 3_000;
const slow = 5_000;

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    refetchInterval: slow,
  });
}

export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: () => api.status(),
    refetchInterval: slow,
  });
}

export function useBlueprints() {
  return useQuery<{ blueprints: Blueprint[] }>({
    queryKey: ["blueprints"],
    queryFn: () => api.blueprints.list(),
    refetchInterval: slow,
  });
}

export function useBlueprint(id: string | undefined) {
  return useQuery<Blueprint>({
    queryKey: ["blueprints", id],
    queryFn: () => api.blueprints.get(id!),
    enabled: Boolean(id),
  });
}

export function useDeployments() {
  return useQuery<{ deployments: Deployment[] }>({
    queryKey: ["deployments"],
    queryFn: () => api.deployments.list(),
    refetchInterval: slow,
  });
}

export function useDeployment(id: string | undefined) {
  return useQuery<Deployment>({
    queryKey: ["deployments", id],
    queryFn: () => api.deployments.get(id!),
    enabled: Boolean(id),
    refetchInterval: med,
  });
}

export function useRuns(filter: { deploymentId?: string; limit?: number } = {}) {
  return useQuery<{ runs: Run[] }>({
    queryKey: ["runs", filter],
    queryFn: () => api.runs.list(filter),
    refetchInterval: (q) => {
      const data = q.state.data;
      const hasInflight = data?.runs?.some((r) => r.status === "queued" || r.status === "running");
      return hasInflight ? fast : med;
    },
  });
}

export function useRun(id: string | undefined) {
  return useQuery<Run>({
    queryKey: ["runs", id],
    queryFn: () => api.runs.get(id!),
    enabled: Boolean(id),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (!status || status === "running" || status === "queued") return fast;
      return false;
    },
  });
}

export function useRunLogs(
  id: string | undefined,
): UseQueryOptions<{ entries: LogEntry[] }> & ReturnType<typeof useQuery<{ entries: LogEntry[] }>> {
  // Polled tail: fetch all logs each tick (server returns full sequence). Cheap for now;
  // can switch to since-cursor when entry counts grow.
  return useQuery<{ entries: LogEntry[] }>({
    queryKey: ["runs", id, "logs"],
    queryFn: () => api.runs.logs(id!) as Promise<{ entries: LogEntry[] }>,
    enabled: Boolean(id),
    refetchInterval: fast,
  }) as never;
}

export function useSecrets() {
  return useQuery<{ secrets: string[] }>({
    queryKey: ["secrets"],
    queryFn: () => api.secrets.list(),
    refetchInterval: slow,
  });
}
