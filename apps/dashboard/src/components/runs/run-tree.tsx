import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import type { Run } from "@oddjob/core";

import { useRunChildren } from "../../api/queries.ts";
import { formatCost, formatDuration } from "../../lib/format.ts";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";
import { RunStatusBadge } from "./RunStatusBadge.tsx";

/**
 * Hard cap on visual recursion depth. `ctx.fork` chains deeper than this
 * collapse into a single "+N forks deeper" link so the tree doesn't visually
 * explode on adversarial pipelines.
 */
const MAX_DEPTH = 4;

export interface RunTreeProps {
  /** Parent (root of the rendered subtree). */
  runId: string;
  /** When true, children queries poll fast (1s); when terminal, stop. */
  live: boolean;
}

export function RunTree({ runId, live }: RunTreeProps): React.JSX.Element {
  const qc = useQueryClient();
  const q = useRunChildren(runId, live);
  const children = q.data?.children ?? [];
  const isLoading = q.isLoading && children.length === 0;

  // When a child terminates (or its cost ticks), the parent's `costUsd`
  // rollup may be stale until the next `useRun` poll. Hashing the children's
  // (status, costUsd) pairs lets us cheaply detect change and invalidate the
  // parent run so the cost stat reflects the rollup live.
  const sig = children.map((c) => `${c.id}:${c.status}:${c.costUsd ?? ""}`).join("|");
  React.useEffect(() => {
    if (!sig) return;
    void qc.invalidateQueries({ queryKey: ["runs", runId], exact: true });
  }, [sig, qc, runId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forked runs</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-(--text-muted)">Loading children…</div>
        ) : children.length === 0 ? (
          <div className="text-sm text-(--text-muted)">No forks for this run.</div>
        ) : (
          <ul className="space-y-1" data-testid="run-tree-rows">
            {children.map((child) => (
              <RunTreeNode key={child.id} run={child} depth={1} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

interface RunTreeNodeProps {
  run: Run;
  depth: number;
}

function RunTreeNode({ run, depth }: RunTreeNodeProps): React.JSX.Element {
  const isLive = run.status === "running" || run.status === "queued";
  const beyondCap = depth >= MAX_DEPTH;
  // Recurse: nested children query is enabled until we hit the visual cap.
  const q = useRunChildren(run.id, isLive, !beyondCap);
  const grandChildren = q.data?.children ?? [];
  const duration = run.startedAt && run.finishedAt ? run.finishedAt - run.startedAt : undefined;

  // Indent — Tailwind needs a static class so we map depth to a fixed pl-* value.
  const indentClass = INDENT_BY_DEPTH[Math.min(depth, MAX_DEPTH)] ?? "pl-0";

  return (
    <li>
      <Link
        to="/runs/$id"
        params={{ id: run.id }}
        className={`group grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-3 rounded-md px-2 py-1.5 text-xs hover:bg-(--surface-2) ${indentClass}`}
      >
        <RunStatusBadge status={run.status} size="sm" />
        <span className="truncate font-mono">
          <span className="text-(--text)">{run.blueprintId}</span>
          <span className="ml-2 text-(--text-muted)">{run.id}</span>
        </span>
        <span className="text-(--text-muted) tabular-nums" title={"depth: " + depth}>
          d{depth}
        </span>
        <span className="tabular-nums text-(--text-muted)" title="cost">
          {formatCost(run.costUsd)}
        </span>
        <span className="tabular-nums text-(--text-muted)" title="duration">
          {formatDuration(duration)}
        </span>
      </Link>

      {beyondCap ? (
        // Visual cap: hint that there's more depth below this node and link
        // straight to it so the user can keep drilling without scrolling 4
        // nested cards. We don't fetch beyond the cap, so we don't know the
        // count at this level — just say "deeper" and let the next page
        // continue the tree.
        <div className={`pl-2 text-[11px] text-(--text-muted) ${indentClass}`}>
          <Link
            to="/runs/$id"
            params={{ id: run.id }}
            className="underline-offset-2 hover:underline"
          >
            +{MAX_DEPTH}+ forks deeper — open run page
          </Link>
        </div>
      ) : grandChildren.length > 0 ? (
        <ul className="space-y-1">
          {grandChildren.map((g) => (
            <RunTreeNode key={g.id} run={g} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// Tailwind can't expand pl-${depth*4} dynamically; static map keeps JIT happy.
const INDENT_BY_DEPTH: Record<number, string> = {
  1: "pl-0",
  2: "pl-4",
  3: "pl-8",
  4: "pl-12",
};
