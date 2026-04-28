import { useEffect, useState } from "react";
import { createRoute } from "@tanstack/react-router";
import { Cable, Loader2 } from "lucide-react";

import {
  useAuthConnectors,
  useInitiateAuth,
  useRevokeAuth,
  type AuthConnectorRow,
} from "../api/queries.ts";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { EmptyState } from "../components/ui/empty-state.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";

import { Route as RootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/mcp",
  component: McpPage,
});

type DisplayStatus =
  | "active"
  | "expired"
  | "reauth_needed"
  | "revoked"
  | "not_configured"
  | "pending";

function badgeFor(status: DisplayStatus): React.JSX.Element {
  if (status === "active") {
    return <Badge className="bg-green-500/15 text-green-700">active</Badge>;
  }
  if (status === "expired" || status === "reauth_needed") {
    return (
      <Badge className="bg-red-500/15 text-red-700">
        {status === "expired" ? "expired" : "reauth needed"}
      </Badge>
    );
  }
  if (status === "revoked") {
    return <Badge className="bg-muted text-muted-foreground">revoked</Badge>;
  }
  if (status === "pending") {
    return (
      <Badge className="bg-amber-500/15 text-amber-700 inline-flex items-center gap-1">
        <Loader2 className="size-3 animate-spin" />
        pending
      </Badge>
    );
  }
  return <Badge className="bg-muted text-muted-foreground">not connected</Badge>;
}

function fmtExpires(ts: number | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function McpPage(): React.JSX.Element {
  const list = useAuthConnectors();
  const initiate = useInitiateAuth();
  const revoke = useRevokeAuth();
  const [pendingIds, setPendingIds] = useState<Record<string, number>>({});

  const tokens = list.data?.tokens ?? [];
  const PENDING_TIMEOUT_MS = 5 * 60_000;

  useEffect(() => {
    setPendingIds((prev) => {
      let changed = false;
      const next: Record<string, number> = { ...prev };
      const now = Date.now();
      for (const t of tokens) {
        if (next[t.connectorId] !== undefined && t.status === "active") {
          delete next[t.connectorId];
          changed = true;
        }
      }
      for (const id of Object.keys(next)) {
        const startedAt = next[id];
        if (startedAt !== undefined && now - startedAt > PENDING_TIMEOUT_MS) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tokens]);

  useEffect(() => {
    if (Object.keys(pendingIds).length === 0) return;
    const timer = window.setTimeout(() => {
      setPendingIds((prev) => {
        const now = Date.now();
        let changed = false;
        const next: Record<string, number> = { ...prev };
        for (const id of Object.keys(next)) {
          const startedAt = next[id];
          if (startedAt !== undefined && now - startedAt > PENDING_TIMEOUT_MS) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, PENDING_TIMEOUT_MS + 1000);
    return () => window.clearTimeout(timer);
  }, [pendingIds]);

  const handleAuthenticate = (row: AuthConnectorRow) => {
    initiate.mutate(
      { deploymentId: row.deploymentId, connectorName: row.connectorName },
      {
        onSuccess: (res) => {
          if (res.redirectUrl && typeof window !== "undefined") {
            window.open(res.redirectUrl, "_blank", "noopener,noreferrer");
            setPendingIds((p) => ({ ...p, [row.connectorId]: Date.now() }));
          } else if (typeof window !== "undefined" && res.message) {
            window.alert(`Cannot start auth flow: ${res.message}`);
          }
        },
        onError: () => {
          setPendingIds((p) => {
            const next = { ...p };
            delete next[row.connectorId];
            return next;
          });
        },
      },
    );
  };

  const handleRevoke = (row: AuthConnectorRow) => {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `Revoke OAuth token for ${row.connectorName} (${row.deploymentId})?`,
      );
      if (!ok) return;
    }
    revoke.mutate(row.connectorId);
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">MCP Connectors</h1>
        <p className="text-sm text-muted-foreground">
          OAuth-authenticated MCP connectors used by your blueprints. Reconnect when status shows
          reauth needed.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Connectors</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : tokens.length === 0 ? (
            <EmptyState
              icon={Cable}
              title="No MCP connectors configured"
              description="Add OAuth2 connectors to your blueprints to see them here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Connector</TableHead>
                  <TableHead>Deployment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((row) => {
                  const raw = row.status as DisplayStatus;
                  const isPending = pendingIds[row.connectorId] !== undefined && raw !== "active";
                  const display: DisplayStatus = isPending ? "pending" : raw;
                  const isActive = raw === "active";
                  const actionLabel =
                    raw === "reauth_needed" || raw === "expired"
                      ? "Re-authenticate"
                      : "Authenticate";
                  return (
                    <TableRow key={row.connectorId}>
                      <TableCell className="font-mono text-sm">{row.connectorName}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.deploymentId}
                      </TableCell>
                      <TableCell>{badgeFor(display)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmtExpires(row.expiresAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {isActive ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={revoke.isPending}
                            onClick={() => handleRevoke(row)}
                          >
                            Revoke
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={initiate.isPending || isPending}
                            onClick={() => handleAuthenticate(row)}
                          >
                            {isPending ? "Waiting for callback…" : actionLabel}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
