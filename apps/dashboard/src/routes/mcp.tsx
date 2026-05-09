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
import { EmptyState } from "../components/ui/empty-state.tsx";
import { Section } from "../components/ui/section.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
import { TimeAgo } from "../components/ui/time-ago.tsx";

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
  if (status === "active")
    return (
      <Badge tone="success" size="sm">
        active
      </Badge>
    );
  if (status === "expired" || status === "reauth_needed")
    return (
      <Badge tone="danger" size="sm">
        {status === "expired" ? "expired" : "reauth needed"}
      </Badge>
    );
  if (status === "revoked") return <Badge size="sm">revoked</Badge>;
  if (status === "pending")
    return (
      <Badge tone="warn" size="sm" className="inline-flex items-center gap-1">
        <Loader2 className="size-3 animate-spin" /> pending
      </Badge>
    );
  return <Badge size="sm">not connected</Badge>;
}


export function McpPageBody(): React.JSX.Element {
  return McpPage();
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
    <Section
      title="MCP connectors"
      description="OAuth-authenticated MCP connectors used by your blueprints. Reconnect when status shows reauth needed."
    >
      {list.isLoading ? (
        <div className="text-sm text-(--text-muted)">Loading…</div>
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
                raw === "reauth_needed" || raw === "expired" ? "Re-authenticate" : "Authenticate";
              return (
                <TableRow key={row.connectorId}>
                  <TableCell className="font-mono text-sm">{row.connectorName}</TableCell>
                  <TableCell className="font-mono text-xs text-(--text-muted)">
                    {row.deploymentId}
                  </TableCell>
                  <TableCell>{badgeFor(display)}</TableCell>
                  <TableCell className="text-sm text-(--text-muted)">
                    <TimeAgo value={row.expiresAt} />
                  </TableCell>
                  <TableCell className="text-right">
                    {isActive ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={revoke.isPending}
                        onClick={() => handleRevoke(row)}
                      >
                        Revoke
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={initiate.isPending || isPending}
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
    </Section>
  );
}
