import * as React from "react";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { Archive, ArchiveRestore, ArrowLeft, Edit3, Pause, Play, X as XIcon } from "lucide-react";

import {
  useBlueprint,
  useCancelRun,
  useDeployment,
  useDeploymentLifecycle,
  useDeploymentNextRun,
  useRuns,
} from "../api/queries.ts";
import { PageContainer } from "../components/layout/PageContainer.tsx";
import { RunStatusBadge } from "../components/runs/RunStatusBadge.tsx";
import { Button } from "../components/ui/button.tsx";
import { DataList } from "../components/ui/data-list.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.tsx";
import { PageHeader } from "../components/ui/page-header.tsx";
import { Section } from "../components/ui/section.tsx";
import { Stat } from "../components/ui/stat.tsx";
import { Surface } from "../components/ui/surface.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
import { useToast } from "../components/ui/toast.tsx";
import { TimeAgo } from "../components/ui/time-ago.tsx";
import { formatCost } from "../lib/format.ts";

import { Route as RootRoute } from "./__root.tsx";
import { StatusBadge } from "./deployments.tsx";

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

  if (dep.isLoading)
    return (
      <PageContainer>
        <div className="text-(--text-muted)">Loading…</div>
      </PageContainer>
    );
  if (!dep.data)
    return (
      <PageContainer>
        <div className="text-(--text-muted)">Deployment not found.</div>
      </PageContainer>
    );

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

  const [namespace, name] = d.blueprintId.split("/") as [string, string];

  return (
    <PageContainer className="space-y-8">
      <PageHeader
        eyebrow={
          <Link to="/deployments" className="inline-flex items-center gap-1 hover:text-(--text)">
            <ArrowLeft className="size-3" /> Deployments
          </Link>
        }
        title={d.name}
        description={
          <span className="inline-flex items-center gap-2">
            <Link
              to="/blueprints/$namespace/$name"
              params={{ namespace, name }}
              className="font-mono text-(--accent-9) hover:underline"
            >
              {d.blueprintId}
              {d.blueprintTag && d.blueprintTag !== "latest" ? `:${d.blueprintTag}` : ""}
            </Link>
            <span className="text-(--text-subtle)">·</span>
            <StatusBadge status={d.status} />
            {blueprint.data ? (
              <span className="text-xs text-(--text-muted)">
                resolves → v{blueprint.data.version}
              </span>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button
              onClick={onTrigger}
              disabled={lifecycle.trigger.isPending || !isActive}
              loading={lifecycle.trigger.isPending}
              title={isActive ? undefined : "Resume to trigger"}
            >
              Trigger now
            </Button>
            {isActive ? (
              <Button
                variant="outline"
                onClick={wrap("Paused", () => lifecycle.pause.mutateAsync(id))}
                loading={lifecycle.pause.isPending}
              >
                <Pause className="size-3.5" /> Pause
              </Button>
            ) : null}
            {isPaused ? (
              <Button
                variant="outline"
                onClick={wrap("Resumed", () => lifecycle.resume.mutateAsync(id))}
                loading={lifecycle.resume.isPending}
              >
                <Play className="size-3.5" /> Resume
              </Button>
            ) : null}
            {isArchived ? (
              <Button
                variant="outline"
                onClick={wrap("Unarchived (paused)", () => lifecycle.unarchive.mutateAsync(id))}
                loading={lifecycle.unarchive.isPending}
              >
                <ArchiveRestore className="size-3.5" /> Unarchive
              </Button>
            ) : null}
            {!isArchived ? (
              <Button
                variant="outline"
                onClick={() => navigate({ to: "/deployments/$id/edit", params: { id } })}
              >
                <Edit3 className="size-3.5" /> Edit
              </Button>
            ) : null}
            {!isArchived ? (
              <Button
                variant="outline"
                onClick={() => navigate({ to: "/deployments/$id/environment", params: { id } })}
              >
                Environment
              </Button>
            ) : null}
            {!isArchived ? (
              <Button variant="destructive" onClick={() => setArchiveDialog(true)}>
                <Archive className="size-3.5" /> Archive
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-3 [&>*+*]:md:border-l [&>*+*]:md:border-(--border-subtle) [&>*+*]:md:pl-6">
        <Stat
          label="Model"
          value={
            <span className="font-mono text-base">
              {d.modelOverride ?? blueprint.data?.model ?? "—"}
            </span>
          }
          hint={d.modelOverride ? "deployment override" : "blueprint default"}
        />
        <Stat
          label="Budget"
          value={d.limits.budgetUsd != null ? `$${d.limits.budgetUsd.toFixed(2)}` : "—"}
          hint={`warn at ${d.limits.warnThresholdPct ?? 80}%`}
        />
        <Stat
          label="Next cron run"
          value={
            hasCron && nextRun.data?.nextRun ? (
              <TimeAgo value={nextRun.data.nextRun} />
            ) : hasCron && d.status !== "active" ? (
              "(paused)"
            ) : (
              "—"
            )
          }
        />
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <Section title="Triggers">
          {d.triggers.length === 0 ? (
            <div className="text-sm text-(--text-muted)">No triggers configured.</div>
          ) : (
            <ul className="space-y-2">
              {d.triggers.map((t, i) => (
                <li key={i} className="font-mono text-sm">
                  <span className="font-medium text-(--text)">{t.type}</span>
                  {t.type === "cron" ? (
                    <span className="text-(--text-muted)">
                      {" "}
                      {t.schedule}
                      {t.timezone ? ` (${t.timezone})` : ""}
                    </span>
                  ) : null}
                  {t.type === "webhook" ? (
                    <span className="text-(--text-muted)">
                      {" "}
                      {t.path ?? `/webhooks/${d.name}`} auth={t.auth.kind}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Channels">
          {d.channels.length === 0 ? (
            <div className="text-sm text-(--text-muted)">No channels configured.</div>
          ) : (
            <ul className="space-y-2">
              {d.channels.map((c, i) => (
                <li key={i} className="font-mono text-sm">
                  <span className="font-medium text-(--text)">{c.type}</span>
                  {c.type === "slack" ? (
                    <span className="text-(--text-muted)"> {c.target}</span>
                  ) : null}
                  {c.type === "email" ? (
                    <span className="text-(--text-muted)"> {String(c.to)}</span>
                  ) : null}
                  {c.type === "webhook" ? (
                    <span className="text-(--text-muted)"> {c.url}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {d.defaultInput !== undefined && d.defaultInput !== null ? (
        <Section title="Default input">
          <Surface variant="raised" padding="sm">
            <pre className="overflow-auto font-mono text-xs">
              {JSON.stringify(d.defaultInput, null, 2)}
            </pre>
          </Surface>
        </Section>
      ) : null}

      <Section title="Recent runs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Run</TableHead>
              <TableHead>Triggered by</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Started</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.data?.runs.map((r) => {
              const cancellable = r.status === "queued" || r.status === "running";
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <RunStatusBadge status={r.status} size="sm" />
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/runs/$id"
                      params={{ id: r.id }}
                      className="font-mono text-xs text-(--accent-9) hover:underline"
                    >
                      {r.id}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-(--text-muted)">{r.triggeredBy}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {formatCost(r.costUsd)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-(--text-muted)">
                    <TimeAgo value={r.startedAt ?? r.createdAt} />
                  </TableCell>
                  <TableCell className="text-right">
                    {cancellable ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onCancelRun(r.id)}
                        loading={cancelRun.isPending}
                      >
                        <XIcon className="size-3.5" /> Cancel
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
            {recent.data?.runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-(--text-muted)">
                  No runs yet for this deployment.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Section>

      <Section title="Metadata">
        <DataList>
          <DataList.Item label="Created">
            <TimeAgo value={d.createdAt} />
          </DataList.Item>
          <DataList.Item label="Updated">
            <TimeAgo value={d.updatedAt} />
          </DataList.Item>
          <DataList.Item label="ID" mono>
            {d.id}
          </DataList.Item>
        </DataList>
      </Section>

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
              loading={lifecycle.archive.isPending}
              onClick={async () => {
                try {
                  await lifecycle.archive.mutateAsync(id);
                  toast.push("success", `Archived ${d.name}`);
                  setArchiveDialog(false);
                } catch (e) {
                  toast.push("error", (e as Error).message);
                }
              }}
            >
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
