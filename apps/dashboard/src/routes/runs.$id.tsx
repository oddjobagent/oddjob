import { createRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2, X as XIcon } from "lucide-react";

import { useCancelRun, useRun, useRunLogs, useRunLogsStream } from "../api/queries.ts";
import { PageContainer } from "../components/layout/PageContainer.tsx";
import { RunStatusBadge } from "../components/runs/RunStatusBadge.tsx";
import { RunWaterfall } from "../components/runs/run-waterfall.tsx";
import { Button } from "../components/ui/button.tsx";
import { DataList } from "../components/ui/data-list.tsx";
import { PageHeader } from "../components/ui/page-header.tsx";
import { Section } from "../components/ui/section.tsx";
import { Stat } from "../components/ui/stat.tsx";
import { Surface } from "../components/ui/surface.tsx";
import { useToast } from "../components/ui/toast.tsx";
import { formatCost, formatDuration, formatTimestamp } from "../lib/format.ts";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/runs/$id",
  component: RunDetail,
});

function RunDetail(): React.JSX.Element {
  const { id } = Route.useParams();
  const run = useRun(id);
  const logs = useRunLogs(id);
  const cancel = useCancelRun();
  const toast = useToast();
  const status = run.data?.status;
  const live = status === "running" || status === "queued";
  useRunLogsStream(id, live);

  if (run.isLoading)
    return (
      <PageContainer>
        <div className="text-(--text-muted)">Loading…</div>
      </PageContainer>
    );
  if (!run.data)
    return (
      <PageContainer>
        <div className="text-(--text-muted)">Run not found.</div>
      </PageContainer>
    );

  const r = run.data;
  const duration = r.startedAt && r.finishedAt ? r.finishedAt - r.startedAt : undefined;

  return (
    <PageContainer className="space-y-8">
      <PageHeader
        eyebrow={
          <Link to="/runs" className="inline-flex items-center gap-1 hover:text-(--text)">
            <ArrowLeft className="size-3" /> Runs
          </Link>
        }
        title={<span className="font-mono">{r.id.slice(0, 12)}</span>}
        description={`${r.blueprintId} · ${r.triggeredBy}`}
        actions={
          <>
            {live ? (
              <span className="inline-flex items-center gap-1 text-xs text-(--text-muted)">
                <Loader2 className="size-3 animate-spin" /> live
              </span>
            ) : null}
            <RunStatusBadge status={r.status} size="lg" />
            {live ? (
              <Button
                variant="outline"
                size="sm"
                loading={cancel.isPending}
                onClick={async () => {
                  try {
                    const res = await cancel.mutateAsync(id);
                    toast.push("success", `Cancelled (${res.result})`);
                  } catch (e) {
                    toast.push("error", (e as Error).message);
                  }
                }}
              >
                <XIcon className="size-3.5" /> Cancel
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4 [&>*+*]:border-l [&>*+*]:border-(--border-subtle) [&>*+*]:pl-6">
        <Stat label="Cost" value={formatCost(r.costUsd)} />
        <Stat
          label="Tokens"
          value={`${r.tokenInput.toLocaleString()} / ${r.tokenOutput.toLocaleString()}`}
        />
        <Stat label="Duration" value={formatDuration(duration)} />
        <Stat label="Tools" value={String(r.toolCalls)} />
      </div>

      <Section title="Metadata">
        <DataList>
          <DataList.Item label="Blueprint" mono>
            {r.blueprintId}
          </DataList.Item>
          <DataList.Item label="Triggered by">{r.triggeredBy}</DataList.Item>
          <DataList.Item label="Started">
            {r.startedAt ? formatTimestamp(r.startedAt) : "—"}
          </DataList.Item>
          <DataList.Item label="Finished">
            {r.finishedAt ? formatTimestamp(r.finishedAt) : "—"}
          </DataList.Item>
        </DataList>
      </Section>

      {r.error ? (
        <Section title="Error">
          <Surface tone="danger" padding="md">
            <pre className="font-mono text-sm text-(--danger-9) whitespace-pre-wrap break-words">
              {r.error}
            </pre>
          </Surface>
        </Section>
      ) : null}

      {r.outputValidation && r.outputValidation.source !== "skipped" ? (
        <Section
          title={`Output validation — ${r.outputValidation.ok ? "passed" : "failed"}${
            r.outputValidation.source === "no-output" ? " (no structured output)" : ""
          }`}
        >
          <Surface tone={r.outputValidation.ok ? "success" : "danger"} padding="md">
            {!r.outputValidation.ok && r.outputValidation.errors ? (
              <ul className="space-y-1 font-mono text-xs">
                {r.outputValidation.errors.map((err, i) => (
                  <li key={i}>
                    <span className="text-(--text-muted)">{err.path || "$"}</span>{" "}
                    <span className="text-(--danger-9)">{err.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-(--text-muted)">All output fields validated.</p>
            )}
          </Surface>
        </Section>
      ) : null}

      {r.input !== undefined && r.input !== null ? (
        <Section title="Input">
          <Surface variant="raised" padding="sm">
            <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
              {typeof r.input === "string" ? r.input : JSON.stringify(r.input, null, 2)}
            </pre>
          </Surface>
        </Section>
      ) : null}

      {r.output ? (
        <Section title="Output">
          <Surface variant="raised" padding="sm" className="space-y-3">
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-(--text-muted)">
                final_text
              </div>
              <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-sm">
                {r.output.finalText || "(empty)"}
              </pre>
            </div>
            {r.output.structuredOutput ? (
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wide text-(--text-muted)">
                  structured_output
                </div>
                <pre className="overflow-auto font-mono text-xs">
                  {JSON.stringify(r.output.structuredOutput, null, 2)}
                </pre>
              </div>
            ) : null}
          </Surface>
        </Section>
      ) : null}

      <RunWaterfall runId={r.id} live={live} startedAt={r.startedAt ?? undefined} />

      <Section title="Logs">
        <Surface variant="raised" padding="sm">
          <div className="max-h-96 space-y-0.5 overflow-auto font-mono text-xs">
            {logs.data?.entries.map((entry, idx) => (
              <div key={idx} className="flex gap-3">
                <span className="shrink-0 text-(--text-muted)">
                  {formatTimestamp(entry.timestamp)}
                </span>
                <span className={levelClass(entry.level)}>{entry.level.padEnd(5)}</span>
                <span>{entry.message}</span>
              </div>
            ))}
            {logs.data?.entries.length === 0 ? (
              <div className="text-(--text-muted)">No log entries.</div>
            ) : null}
          </div>
        </Surface>
      </Section>
    </PageContainer>
  );
}

function levelClass(level: string): string {
  switch (level) {
    case "error":
      return "text-(--danger-9)";
    case "warn":
      return "text-(--warn-9)";
    case "info":
      return "text-(--text)";
    case "debug":
      return "text-(--text-muted)";
    default:
      return "";
  }
}
