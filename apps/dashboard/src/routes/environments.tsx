import * as React from "react";
import { createRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Boxes, Star, Trash2 } from "lucide-react";

import type { Deployment, Environment } from "@oddjob/core";
import type { EnvironmentProviderDescriptor } from "@oddjob/api-client";

import {
  useDeployments,
  useEngine,
  useEnvironmentMutations,
  useEnvironmentProviders,
  useEnvironments,
} from "../api/queries.ts";
import { PageContainer } from "../components/layout/PageContainer.tsx";
import { TrustTierBadge } from "../components/environments/TrustTierBadge.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.tsx";
import { EmptyState } from "../components/ui/empty-state.tsx";
import { PageHeader } from "../components/ui/page-header.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
import { Tooltip } from "../components/ui/tooltip.tsx";
import { useToast } from "../components/ui/toast.tsx";

import { EnvironmentProvidersPage } from "./environments.providers.tsx";
import { Route as RootRoute } from "./__root.tsx";

type EnvTab = "environments" | "backends";

interface EnvSearch {
  tab: EnvTab;
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/environments",
  component: EnvironmentsPage,
  validateSearch: (raw): EnvSearch => ({
    tab: raw.tab === "backends" ? "backends" : "environments",
  }),
});

function EnvironmentsPage(): React.JSX.Element {
  const { tab } = useSearch({ from: "/environments" });
  const navigate = useNavigate();
  const setTab = (v: string) => navigate({ to: "/environments", search: { tab: v as EnvTab } });

  return (
    <PageContainer className="space-y-6">
      <Tabs value={tab} onValueChange={setTab}>
        <PageHeader
          title="Environments"
          description="Reusable execution environments — provider, networking, resources. Deployments reference one of these by id."
          tabs={
            <TabsList>
              <TabsTrigger value="environments">Environments</TabsTrigger>
              <TabsTrigger value="backends">Backends</TabsTrigger>
            </TabsList>
          }
        />
        <TabsContent value="environments">
          <EnvironmentsList />
        </TabsContent>
        <TabsContent value="backends">
          <EnvironmentProvidersPage />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function EnvironmentsList(): React.JSX.Element {
  const envs = useEnvironments();
  const engine = useEngine();
  const providers = useEnvironmentProviders();
  const deployments = useDeployments(true);
  const { remove, setDefault } = useEnvironmentMutations();
  const toast = useToast();
  const [deleteTarget, setDeleteTarget] = React.useState<Environment | null>(null);

  const defaultId = engine.data?.defaultEnvironmentId ?? null;

  const providerIndex = React.useMemo(() => {
    const map = new Map<string, EnvironmentProviderDescriptor>();
    for (const p of providers.data?.providers ?? []) map.set(p.id, p);
    return map;
  }, [providers.data]);

  const referencedBy = React.useMemo(() => {
    const map = new Map<string, Deployment[]>();
    for (const d of deployments.data?.deployments ?? []) {
      if (!d.environmentId) continue;
      const list = map.get(d.environmentId) ?? [];
      list.push(d);
      map.set(d.environmentId, list);
    }
    return map;
  }, [deployments.data]);

  const onSetDefault = async (id: string) => {
    try {
      await setDefault.mutateAsync(id);
      toast.push("success", `Default environment → ${id}`);
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  const onClearDefault = async () => {
    try {
      await setDefault.mutateAsync(null);
      toast.push("success", "Cleared engine default environment");
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await remove.mutateAsync(deleteTarget.id);
      toast.push("success", `Deleted ${deleteTarget.id}`);
      setDeleteTarget(null);
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-(--text-muted)">
          {defaultId ? (
            <>
              Engine default: <span className="font-mono text-(--text)">{defaultId}</span>
            </>
          ) : (
            "No engine default set."
          )}
        </div>
        {defaultId ? (
          <Button variant="ghost" size="sm" onClick={onClearDefault} loading={setDefault.isPending}>
            Clear default
          </Button>
        ) : null}
      </div>

      {envs.isLoading ? (
        <div className="text-sm text-(--text-muted)">Loading…</div>
      ) : envs.data?.environments.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No environments yet"
          description="Push one with `oddjob environment push environments/<name>`."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Id</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Trust</TableHead>
              <TableHead>Networking</TableHead>
              <TableHead>Resources</TableHead>
              <TableHead className="text-right">Used by</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {envs.data?.environments.map((e) => {
              const isDefault = e.id === defaultId;
              const svc = e.config.provider?.service;
              const provider = svc ? providerIndex.get(svc) : undefined;
              const tier = provider?.trustTier;
              const refs = referencedBy.get(e.id) ?? [];
              const lockReason = isDefault
                ? "Engine default — clear it before deleting."
                : refs.length > 0
                  ? `Referenced by ${refs.length} deployment${
                      refs.length === 1 ? "" : "s"
                    } — re-point them first.`
                  : null;
              return (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{e.id}</span>
                      {isDefault ? (
                        <Badge tone="warn" size="sm">
                          <Star className="mr-1 size-3" /> default
                        </Badge>
                      ) : null}
                    </div>
                    {e.name && e.name !== e.id ? (
                      <div className="text-xs text-(--text-muted)">{e.name}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {svc ? (
                      <span className="font-mono text-sm">{svc}</span>
                    ) : (
                      <span className="text-xs italic text-(--text-muted)">(engine default)</span>
                    )}
                    {e.config.provider?.credential && e.config.provider.credential !== "default" ? (
                      <div className="text-xs text-(--text-muted)">
                        cred: {e.config.provider.credential}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>{tier ? <TrustTierBadge tier={tier} /> : "—"}</TableCell>
                  <TableCell className="text-xs text-(--text-muted)">
                    {networkingSummary(e)}
                  </TableCell>
                  <TableCell className="text-xs text-(--text-muted)">
                    {resourcesSummary(e)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {refs.length === 0 ? (
                      <span className="text-(--text-muted)">0</span>
                    ) : (
                      <Tooltip content={refs.map((d) => d.name).join(", ")}>
                        <span>{refs.length}</span>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {!isDefault ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onSetDefault(e.id)}
                          loading={setDefault.isPending}
                        >
                          Set default
                        </Button>
                      ) : null}
                      {lockReason ? (
                        <Tooltip content={lockReason}>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled
                            aria-label={`Delete ${e.id}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </Tooltip>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(e)}
                          loading={remove.isPending}
                          aria-label={`Delete ${e.id}`}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <DeleteEnvironmentDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        pending={remove.isPending}
      />
    </div>
  );
}

function DeleteEnvironmentDialog({
  target,
  onClose,
  onConfirm,
  pending,
}: {
  target: Environment | null;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}): React.JSX.Element | null {
  if (!target) return null;
  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>
            Delete <span className="font-mono">{target.id}</span>?
          </DialogTitle>
          <DialogDescription>
            Removes the environment record. Existing run history is unaffected — those rows already
            carry an environment snapshot. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} loading={pending}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function networkingSummary(e: Environment): string {
  const n = e.config.networking;
  if (!n) return "—";
  if (n.type === "unrestricted") return "unrestricted";
  const hosts = n.allowedHosts.length;
  return `limited · ${hosts} host${hosts === 1 ? "" : "s"}`;
}

function resourcesSummary(e: Environment): string {
  const r = e.config.resources;
  if (!r) return "—";
  const parts: string[] = [];
  if (r.cpu != null) parts.push(`${r.cpu} cpu`);
  if (r.memMb != null) parts.push(`${r.memMb} MB`);
  if (r.diskMb != null) parts.push(`${r.diskMb} MB disk`);
  return parts.join(" · ") || "—";
}
