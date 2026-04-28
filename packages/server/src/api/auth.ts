import type { Runtime } from "../runtime.ts";
import { type Handler, badRequest, json, notFound, readJson } from "../middleware/index.ts";

interface InitiateBody {
  deploymentId: string;
  connectorName: string;
}

interface AuthListRow {
  connectorId: string;
  deploymentId: string;
  connectorName: string;
  status: string;
  expiresAt?: number;
  scopes?: string;
  updatedAt: number;
}

export const list =
  (rt: Runtime): Handler =>
  async () => {
    const [tokens, deployments] = await Promise.all([
      rt.state.listConnectorTokens(),
      rt.state.listDeployments(),
    ]);
    const tokenById = new Map(tokens.map((t) => [t.connectorId, t]));
    const rows: AuthListRow[] = [];
    const seen = new Set<string>();
    for (const dep of deployments) {
      const bp = await rt.state.getBlueprint(dep.blueprintId);
      if (!bp?.connectors) continue;
      for (const [name, conn] of Object.entries(bp.connectors)) {
        if (conn.auth?.kind !== "oauth2") continue;
        const connectorId = `${dep.id}:${name}`;
        seen.add(connectorId);
        const tok = tokenById.get(connectorId);
        const liveStatus = rt.auth
          ? await rt.auth.status(connectorId)
          : tok?.status ?? "not_configured";
        rows.push({
          connectorId,
          deploymentId: dep.id,
          connectorName: name,
          status: liveStatus,
          expiresAt: tok?.expiresAt,
          scopes: tok?.scopes,
          updatedAt: tok?.updatedAt ?? 0,
        });
      }
    }
    for (const t of tokens) {
      if (seen.has(t.connectorId)) continue;
      const liveStatus = rt.auth ? await rt.auth.status(t.connectorId) : t.status;
      rows.push({
        connectorId: t.connectorId,
        deploymentId: t.deploymentId,
        connectorName: t.connectorName,
        status: liveStatus,
        expiresAt: t.expiresAt,
        scopes: t.scopes,
        updatedAt: t.updatedAt,
      });
    }
    return json({ tokens: rows });
  };

export const status =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    if (!rt.auth) return badRequest("auth provider not configured");
    const id = ctx.params.connectorId ?? "";
    const status = await rt.auth.status(id);
    return json({ connectorId: id, status });
  };

export const initiate =
  (rt: Runtime): Handler =>
  async (req) => {
    if (!rt.auth) return badRequest("auth provider not configured");
    const body = await readJson<InitiateBody>(req);
    if (!body || !body.deploymentId || !body.connectorName) {
      return badRequest("body must include deploymentId + connectorName");
    }
    const dep = await rt.state.getDeployment(body.deploymentId);
    if (!dep) return notFound("deployment not found");
    const bp = await rt.state.getBlueprint(dep.blueprintId);
    if (!bp) return notFound("blueprint not found");
    const connector = bp.connectors[body.connectorName];
    if (!connector) return notFound("connector not declared on blueprint");
    if (connector.auth.kind !== "oauth2") {
      return badRequest(`connector ${body.connectorName} is not oauth2`);
    }
    const connectorId = `${dep.id}:${body.connectorName}`;
    const result = await rt.auth.initiateFlow(connectorId, connector);
    return json({ connectorId, ...result });
  };

export const revoke =
  (rt: Runtime): Handler =>
  async (_req, ctx) => {
    if (!rt.auth) return badRequest("auth provider not configured");
    const id = ctx.params.connectorId ?? "";
    await rt.auth.revokeToken(id);
    return new Response(null, { status: 204 });
  };
