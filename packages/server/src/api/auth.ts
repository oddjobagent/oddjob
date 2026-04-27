import type { Runtime } from "../runtime.ts";
import {
  type Handler,
  badRequest,
  json,
  notFound,
  readJson,
} from "../middleware/index.ts";

interface InitiateBody {
  deploymentId: string;
  connectorName: string;
}

export const list =
  (rt: Runtime): Handler =>
  async () => {
    const tokens = await rt.state.listConnectorTokens();
    // Never return token plaintext or ciphertext to the client.
    const safe = tokens.map((t) => ({
      connectorId: t.connectorId,
      deploymentId: t.deploymentId,
      connectorName: t.connectorName,
      status: t.status,
      expiresAt: t.expiresAt,
      scopes: t.scopes,
      updatedAt: t.updatedAt,
    }));
    return json({ tokens: safe });
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
