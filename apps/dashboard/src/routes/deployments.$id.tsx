import * as React from "react";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Edit3, Pause, Play, X as XIcon } from "lucide-react";

import {
  useBlueprint,
  useCancelRun,
  useDeployment,
  useDeploymentLifecycle,
  useDeploymentNextRun,
  useRuns,
} from "../api/queries.ts";
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
import { RunStatusBadge } from "../components/runs/RunStatusBadge.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
import { useToast } from "../components/ui/toast.tsx";
import { formatCost, formatRelative } from "../lib/format.ts";
import { StatusBadge } from "./deployments.tsx";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/deployments/$id",
  component: DeploymentDetail,
});

function DeploymentDetail(): React.JSX.Element {
  const { id } = Route.useParams();
  const dep = useDeployment(id);
  const recent = useRuns({ deploymentId: id, limit: 25 });
  const navigate = useNavigate();
  const lifecycle = useDeploymentLifecycle();
  const cancelRun = useCancelRun();
  const toast = useToast();

  const hasCron = (dep.data?.triggers ?? []).some((t) => t.type === "cron");
  const nextRun = useDeploymentNextRun(id, hasCron && dep.data?.status === "active");
  const blueprint = useBlueprint(dep.data?.blueprintId, {
    tag: dep.data?.blueprintTag,
  });

  const [archiveDialog, setArchiveDialog] = React.useState(false);

  if (dep.isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!dep.data) return <div className="text-muted-foreground">Deployment not found.</div>;

  const d = dep.data;
  const isActive = d.status === "active";
  const isPaused = d.status === "paused";
  const isArchived = d.status === "archived";

  const onTrigger = async () => {
    try {
      const res = await lifecycle.trigger.mutateAsync({ id });
      navigate({ to: "/runs/$id", params: { id: res.run_id } });
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  const wrap = (label: string, fn: () => Promise<unknown>) => async () => {
    try {
      await fn();
      toast.push("success", label);
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  const onCancelRun = async (runId: string) => {
    try {
      const res = await cancelRun.mutateAsync(runId);
      toast.push("success", `Cancelled run (${res.result})`);
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link to="/deployments" className="text-xs text-muted-foreground hover:underline">
            ← Deployments
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">{d.name}</h1>
          <p className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
            <Link
              to="/blueprints/$namespace/$name"
              params={{
                namespace: d.blueprintId.split("/")[0]!,
                name: d.blueprintId.split("/")[1]!,
              }}
              className="font-mono hover:underline"
            >
              {d.blueprintId}
              {d.blueprintTag && d.blueprintTag !== "latest" ? `:${d.blueprintTag}` : ""}
            </Link>
            <span>·</span>
            <StatusBadge status={d.status} />
            {blueprint.data && (
              <span className="text-xs">resolves → v{blueprint.data.version}</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={onTrigger}
            disabled={lifecycle.trigger.isPending || !isActive}
            title={isActive ? undefined : "Resume to trigger"}
          >
            {lifecycle.trigger.isPending ? "Triggering…" : "Trigger now"}
          </Button>
          {isActive && (
            <Button
              variant="outline"
              onClick={wrap("Paused", () => lifecycle.pause.mutateAsync(id))}
              disabled={lifecycle.pause.isPending}
            >
              <Pause className="size-4" /> Pause
            </Button>
          )}
          {isPaused && (
            <Button
              variant="outline"
              onClick={wrap("Resumed", () => lifecycle.resume.mutateAsync(id))}
              disabled={lifecycle.resume.isPending}
            >
              <Play className="size-4" /> Resume
            </Button>
          )}
          {isArchived && (
            <Button
              variant="outline"
              onClick={wrap("Unarchived (paused)", () => lifecycle.unarchive.mutateAsync(id))}
              disabled={lifecycle.unarchive.isPending}
            >
              <ArchiveRestore className="size-4" /> Unarchive
            </Button>
          )}
          {!isArchived && (
            <Button
              variant="outline"
              onClick={() => navigate({ to: "/deployments/$id/edit", params: { id } })}
            >
              <Edit3 className="size-4" /> Edit
            </Button>
          )}
          {!isArchived && (
            <Button variant="destructive" onClick={() => setArchiveDialog(true)}>
              <Archive className="size-4" /> Archive
            </Button>
          )}
        </div>
      </header>

      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Model</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-sm">
              {d.modelOverride ?? blueprint.data?.model ?? "—"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {d.modelOverride ? "deployment override" : "blueprint default"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Budget</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm">
              {d.limits.budgetUsd != null ? `$${d.limits.budgetUsd.toFixed(2)} / run` : "—"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              warn at {d.limits.warnThresholdPct ?? 80}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Next cron run</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm">
              {hasCron && nextRun.data?.nextRun
                ? new Date(nextRun.data.nextRun).toLocaleString()
                : hasCron && d.status !== "active"
                  ? "(paused)"
                  : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Triggers</CardTitle>
          </CardHeader>
          <CardContent>
            {d.triggers.length === 0 ? (
              <div className="text-sm text-muted-foreground">No triggers configured.</div>
            ) : (
              <ul className="text-sm space-y-2">
                {d.triggers.map((t, i) => (
                  <li key={i} className="font-mono">
                    <span className="font-medium">{t.type}</span>
                    {t.type === "cron" && (
                      <span className="text-muted-foreground">
                        {" "}
                        {t.schedule}
                        {t.timezone ? ` (${t.timezone})` : ""}
                      </span>
                    )}
                    {t.type === "webhook" && (
                      <span className="text-muted-foreground">
                        {" "}
                        {t.path ?? `/webhooks/${d.name}`} auth={t.auth.kind}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Channels</CardTitle>
          </CardHeader>
          <CardContent>
            {d.channels.length === 0 ? (
              <div className="text-sm text-muted-foreground">No channels configured.</div>
            ) : (
              <ul className="text-sm space-y-2">
                {d.channels.map((c, i) => (
                  <li key={i} className="font-mono">
                    <span className="font-medium">{c.type}</span>
                    {c.type === "slack" && (
                      <span className="text-muted-foreground"> {c.target}</span>
                    )}
                    {c.type === "email" && (
                      <span className="text-muted-foreground"> {String(c.to)}</span>
                    )}
                    {c.type === "webhook" && (
                      <span className="text-muted-foreground"> {c.url}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {d.defaultInput !== undefined && d.defaultInput !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Default input</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-auto rounded-md bg-muted/30 p-3 text-xs">
              {JSON.stringify(d.defaultInput, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Run</TableHead>
              <TableHead>Triggered by</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Started</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.data?.runs.map((r) => {
              const cancellable = r.status === "queued" || r.status === "running";
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <RunStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/runs/$id"
                      params={{ id: r.id }}
                      className="font-mono text-xs hover:underline"
                    >
                      {r.id.slice(0, 8)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{r.triggeredBy}</TableCell>
                  <TableCell className="text-sm tabular-nums">{formatCost(r.costUsd)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatRelative(r.startedAt ?? r.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {cancellable && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onCancelRun(r.id)}
                        disabled={cancelRun.isPending}
                      >
                        <XIcon className="size-3.5" /> Cancel
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {recent.data?.runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No runs yet for this deployment.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={archiveDialog} onOpenChange={setArchiveDialog}>
        <DialogContent onClose={() => setArchiveDialog(false)}>
          <DialogHeader>
            <DialogTitle>Archive {d.name}?</DialogTitle>
            <DialogDescription>
              Archiving stops cron firing and hides the deployment from the default list. Run
              history is preserved. You can unarchive later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                try {
                  await lifecycle.archive.mutateAsync(id);
                  toast.push("success", `Archived ${d.name}`);
                  setArchiveDialog(false);
                } catch (e) {
                  toast.push("error", (e as Error).message);
                }
              }}
              disabled={lifecycle.archive.isPending}
            >
              {lifecycle.archive.isPending ? "Archiving…" : "Archive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
