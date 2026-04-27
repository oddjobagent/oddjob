import * as React from "react";
import { createRoute, Link } from "@tanstack/react-router";
import { Star, Trash2 } from "lucide-react";

import type { Deployment, Environment } from "@oddjob/core";
import type { EnvironmentProviderDescriptor } from "@oddjob/api-client";

import {
  useDeployments,
  useEngine,
  useEnvironmentMutations,
  useEnvironmentProviders,
  useEnvironments,
} from "../api/queries.ts";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
import { useToast } from "../components/ui/toast.tsx";
import { TrustTierBadge } from "../components/environments/TrustTierBadge.tsx";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/environments",
  component: Environments,
});

function Environments(): React.JSX.Element {
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
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Environments</h1>
          <p className="text-sm text-muted-foreground">
            Reusable execution environments. Each picks a registered provider (process / seatbelt /
            docker / daytona / …) and declares packages, networking, and resource caps. Deployments
            reference one of these by id, or fall through to the engine default.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/environments/providers">
            <Button variant="outline">Providers</Button>
          </Link>
          {defaultId && (
            <Button
              variant="ghost"
              onClick={onClearDefault}
              disabled={setDefault.isPending}
              title="Clear the engine default — deployments without an environment will fall through to the platform hard default."
            >
              Clear default
            </Button>
          )}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            All environments
            {defaultId ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                engine default: <span className="font-mono">{defaultId}</span>
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {envs.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : envs.data?.environments.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No environments yet. Push one with{" "}
              <code className="font-mono text-xs">oddjob environment push environments/foo</code>.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Id</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Trust</TableHead>
                  <TableHead>Networking</TableHead>
                  <TableHead>Resources</TableHead>
                  <TableHead>Used by</TableHead>
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
                      ? `Referenced by ${refs.length} deployment${refs.length === 1 ? "" : "s"} — re-point them first.`
                      : null;
                  return (
                    <TableRow key={e.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{e.id}</span>
                          {isDefault && (
                            <Badge className="bg-amber-500/15 text-amber-700">
                              <Star className="size-3 mr-1" /> default
                            </Badge>
                          )}
                        </div>
                        {e.name && e.name !== e.id ? (
                          <div className="text-xs text-muted-foreground">{e.name}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {svc ? (
                          <span className="font-mono text-sm">{svc}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">
                            (engine default)
                          </span>
                        )}
                        {e.config.provider?.credential &&
                        e.config.provider.credential !== "default" ? (
                          <div className="text-xs text-muted-foreground">
                            cred: {e.config.provider.credential}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>{tier ? <TrustTierBadge tier={tier} /> : "—"}</TableCell>
                      <TableCell className="text-sm">{networkingSummary(e)}</TableCell>
                      <TableCell className="text-sm">{resourcesSummary(e)}</TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {refs.length === 0 ? (
                          <span className="text-muted-foreground">0</span>
                        ) : (
                          <span title={refs.map((d) => d.name).join(", ")}>{refs.length}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {!isDefault && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onSetDefault(e.id)}
                              disabled={setDefault.isPending}
                              title="Make this the engine-wide default for deployments without an explicit environment."
                            >
                              Set default
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget(e)}
                            disabled={remove.isPending || lockReason !== null}
                            aria-label={`Delete ${e.id}`}
                            title={lockReason ?? `Delete ${e.id}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How to add an environment</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p>
            Create{" "}
            <code className="font-mono text-xs">environments/&lt;name&gt;/environment.toml</code>{" "}
            and run{" "}
            <code className="font-mono text-xs">
              oddjob environment push environments/&lt;name&gt;
            </code>
            . The dashboard refreshes automatically.
          </p>
          <p>
            Use the{" "}
            <Link to="/environments/providers" className="underline">
              Providers
            </Link>{" "}
            page to see which backends are installed and which capabilities they expose.
          </p>
        </CardContent>
      </Card>

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
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? "Deleting…" : "Delete"}
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
