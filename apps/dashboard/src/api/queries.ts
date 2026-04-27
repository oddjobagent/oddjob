import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Blueprint, ChannelConfig, Deployment, LogEntry, Run } from "@oddjob/core";
import type {
  BuiltinToolDescriptor,
  ChannelTypeDescriptor,
  ModelOption,
} from "@oddjob/api-client";

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

export function useDeployments(includeArchived = false) {
  return useQuery<{ deployments: Deployment[] }>({
    queryKey: ["deployments", { includeArchived }],
    queryFn: () => api.deployments.list({ includeArchived }),
    refetchInterval: slow,
  });
}

export function useDeploymentNextRun(id: string | undefined, hasCron: boolean) {
  return useQuery<{ deploymentId: string; nextRun: number | null }>({
    queryKey: ["deployments", id, "next-run"],
    queryFn: () => api.deployments.nextRun(id!),
    enabled: Boolean(id) && hasCron,
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

export function useRunLogs(id: string | undefined) {
  // Polled tail w/ cursor. Each tick requests entries strictly newer than the
  // last seen timestamp; the cached array accumulates. Avoids re-downloading
  // the full log every second. SSE upgrade is in `useRunLogsStream`.
  const queryClient = useQueryClient();
  return useQuery<{ entries: LogEntry[] }>({
    queryKey: ["runs", id, "logs"],
    queryFn: async () => {
      const cached = queryClient.getQueryData<{ entries: LogEntry[] }>(["runs", id, "logs"]);
      const lastTs = cached?.entries.at(-1)?.timestamp;
      const since = lastTs ? lastTs + 1 : 0;
      const fresh = (await api.runs.logs(id!, since)) as { entries: LogEntry[] };
      return { entries: [...(cached?.entries ?? []), ...fresh.entries] };
    },
    enabled: Boolean(id),
    refetchInterval: fast,
    refetchOnWindowFocus: false,
  });
}

/**
 * Subscribe to a run's logs via SSE while the run is live. Updates the same
 * query cache as `useRunLogs` so consumers don't have to choose. Falls back to
 * polling when SSE drops or the run terminates.
 */
export function useRunLogsStream(id: string | undefined, live: boolean): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!id || !live || typeof window === "undefined") return;
    const cached =
      queryClient.getQueryData<{ entries: LogEntry[] }>(["runs", id, "logs"]) ?? { entries: [] };
    const lastTs = cached.entries.at(-1)?.timestamp ?? 0;
    const url = `${window.location.origin}/api/v1/runs/${id}/logs?stream=1&since=${
      lastTs ? lastTs + 1 : 0
    }`;
    const es = new EventSource(url);
    es.onmessage = (ev) => {
      try {
        const entry = JSON.parse(ev.data) as LogEntry;
        const cur =
          queryClient.getQueryData<{ entries: LogEntry[] }>(["runs", id, "logs"]) ?? {
            entries: [],
          };
        queryClient.setQueryData(["runs", id, "logs"], {
          entries: [...cur.entries, entry],
        });
      } catch {
        // ignore malformed event
      }
    };
    es.addEventListener("end", () => es.close());
    es.onerror = () => es.close();
    return () => es.close();
  }, [id, live, queryClient]);
}

export function useSecrets() {
  return useQuery<{ secrets: string[] }>({
    queryKey: ["secrets"],
    queryFn: () => api.secrets.list(),
    refetchInterval: slow,
  });
}

// ── Engine + Channels + Models ────────────────────────────────────────

export function useEngine() {
  return useQuery({
    queryKey: ["engine"],
    queryFn: () => api.engine.get(),
    refetchInterval: slow,
  });
}

export function useEngineTools() {
  return useQuery<{ tools: BuiltinToolDescriptor[] }>({
    queryKey: ["engine", "tools"],
    queryFn: () => api.engine.tools(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateEngine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.engine.update,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["engine"] }),
  });
}

export function useModels() {
  return useQuery<{ models: ModelOption[] }>({
    queryKey: ["models"],
    queryFn: () => api.models.list(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useChannelTypes() {
  return useQuery<{ types: ChannelTypeDescriptor[] }>({
    queryKey: ["channels", "types"],
    queryFn: () => api.channels.types(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useTestChannel() {
  return useMutation({
    mutationFn: ({ config, message }: { config: ChannelConfig; message?: string }) =>
      api.channels.test(config, message),
  });
}

export function useChannelTemplates() {
  return useQuery({
    queryKey: ["channel-templates"],
    queryFn: () => api.channels.listTemplates(),
    refetchInterval: slow,
  });
}

export function useChannelTemplateMutations() {
  const queryClient = useQueryClient();
  const upsert = useMutation({
    mutationFn: api.channels.upsertTemplate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["channel-templates"] }),
  });
  const remove = useMutation({
    mutationFn: api.channels.deleteTemplate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["channel-templates"] }),
  });
  return { upsert, remove };
}

export function useCronPreview() {
  return useMutation({
    mutationFn: ({
      schedule,
      timezone,
      count,
    }: {
      schedule: string;
      timezone?: string;
      count?: number;
    }) => api.cron.preview(schedule, timezone, count),
  });
}

// ── Mutations: deployment lifecycle + run cancel ──────────────────────

export function useDeploymentLifecycle() {
  const queryClient = useQueryClient();
  const invalidate = (id?: string) => {
    queryClient.invalidateQueries({ queryKey: ["deployments"] });
    if (id) queryClient.invalidateQueries({ queryKey: ["deployments", id] });
  };

  const pause = useMutation({
    mutationFn: api.deployments.pause,
    onSuccess: (d) => invalidate(d.id),
  });
  const resume = useMutation({
    mutationFn: api.deployments.resume,
    onSuccess: (d) => invalidate(d.id),
  });
  const archive = useMutation({
    mutationFn: api.deployments.archive,
    onSuccess: (d) => invalidate(d.id),
  });
  const unarchive = useMutation({
    mutationFn: api.deployments.unarchive,
    onSuccess: (d) => invalidate(d.id),
  });
  const trigger = useMutation({
    mutationFn: ({ id, input }: { id: string; input?: unknown }) =>
      api.deployments.trigger(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["runs"] }),
  });
  const create = useMutation({
    mutationFn: api.deployments.create,
    onSuccess: () => invalidate(),
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: unknown }) =>
      api.deployments.update(id, patch),
    onSuccess: (d) => invalidate(d.id),
  });

  return { pause, resume, archive, unarchive, trigger, create, update };
}

export function useCancelRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.runs.cancel,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      queryClient.invalidateQueries({ queryKey: ["runs", data.runId] });
    },
  });
}

export function useSecretMutations() {
  const queryClient = useQueryClient();
  const set = useMutation({
    mutationFn: ({ name, value }: { name: string; value: string }) =>
      api.secrets.set(name, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["secrets"] }),
  });
  const remove = useMutation({
    mutationFn: api.secrets.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["secrets"] }),
  });
  return { set, remove };
}
