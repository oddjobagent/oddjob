import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type {
  AuthFlowResult,
  AuthProvider,
  AuthStatus,
  Connector,
  ConnectorTokenRecord,
  SecretsProvider,
  StateProvider,
} from "@oddjob/core";
import { open as openSealed, seal } from "@oddjob/secrets-sqlite";

interface PendingFlow {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  redirectUri: string;
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  scopes?: string[];
  resolve: (record: ConnectorTokenRecord) => void;
  reject: (err: Error) => void;
  server: Server;
  port: number;
}

export interface AuthLocalOptions {
  state: StateProvider;
  secrets: SecretsProvider;
  /** Master key for encrypting tokens. */
  masterKey: Buffer;
  /** ms before expiry to consider a token expired (default 60s). */
  refreshSkewMs?: number;
}

const REFRESH_SKEW_DEFAULT = 60_000;

export class AuthLocalProvider implements AuthProvider {
  readonly name = "auth-local";
  private readonly state: StateProvider;
  private readonly secrets: SecretsProvider;
  private readonly masterKey: Buffer;
  private readonly refreshSkewMs: number;
  private pending = new Map<string, PendingFlow>();

  constructor(opts: AuthLocalOptions) {
    this.state = opts.state;
    this.secrets = opts.secrets;
    this.masterKey = opts.masterKey;
    this.refreshSkewMs = opts.refreshSkewMs ?? REFRESH_SKEW_DEFAULT;
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {
    for (const p of this.pending.values()) p.server.close();
    this.pending.clear();
  }
  async healthy(): Promise<boolean> {
    return true;
  }

  async getToken(connectorId: string): Promise<string> {
    const rec = await this.state.getConnectorToken(connectorId);
    if (!rec) throw new Error(`no token for ${connectorId} (run 'oddjob mcp auth')`);
    return this.openToken(rec.accessTokenEncrypted, connectorId);
  }

  async revokeToken(connectorId: string): Promise<void> {
    await this.state.deleteConnectorToken(connectorId);
  }

  async status(connectorId: string): Promise<AuthStatus> {
    const rec = await this.state.getConnectorToken(connectorId);
    if (!rec) return "not_configured";
    if (rec.status === "reauth_needed") return "reauth_needed";
    if (rec.expiresAt && rec.expiresAt <= Date.now()) return "expired";
    return "authenticated";
  }

  async refreshIfNeeded(connectorId: string): Promise<string> {
    const rec = await this.state.getConnectorToken(connectorId);
    if (!rec) throw new Error(`no token for ${connectorId}`);
    if (!rec.expiresAt || rec.expiresAt - this.refreshSkewMs > Date.now()) {
      return this.openToken(rec.accessTokenEncrypted, connectorId);
    }
    if (!rec.refreshTokenEncrypted || !rec.tokenUrl || !rec.clientId) {
      // Mark for re-auth — caller should trigger initiateFlow.
      await this.state.upsertConnectorToken({
        ...rec,
        status: "reauth_needed",
        updatedAt: Date.now(),
      });
      throw new Error(`token expired and not refreshable for ${connectorId}`);
    }
    const refreshToken = this.openToken(rec.refreshTokenEncrypted, connectorId);
    const clientSecret = rec.clientSecretEncrypted
      ? this.openToken(rec.clientSecretEncrypted, connectorId)
      : undefined;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: rec.clientId,
    });
    if (clientSecret) body.set("client_secret", clientSecret);

    const resp = await fetch(rec.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!resp.ok) {
      await this.state.upsertConnectorToken({
        ...rec,
        status: "reauth_needed",
        updatedAt: Date.now(),
      });
      throw new Error(`refresh failed: ${resp.status} ${await resp.text()}`);
    }
    const tokenJson = (await resp.json()) as TokenResponse;
    const updated = await this.persistToken(
      rec.connectorId,
      rec.deploymentId,
      rec.connectorName,
      {
        tokenUrl: rec.tokenUrl,
        clientId: rec.clientId,
        clientSecret: clientSecret ?? undefined,
        scopes: rec.scopes,
        tokenJson,
        // Keep existing refresh token if a new one isn't issued.
        existingRefreshToken: refreshToken,
      },
    );
    return this.openToken(updated.accessTokenEncrypted, connectorId);
  }

  async initiateFlow(connectorId: string, connector: Connector): Promise<AuthFlowResult> {
    if (connector.auth.kind !== "oauth2") {
      return { status: "not_configured", message: "connector is not oauth2" };
    }
    const auth = connector.auth;
    if (!auth.authorizationUrl || !auth.tokenUrl) {
      return {
        status: "not_configured",
        message: "oauth2 connector requires authorizationUrl + tokenUrl",
      };
    }
    if (!auth.clientIdRef) {
      return { status: "not_configured", message: "oauth2 connector requires clientIdRef" };
    }
    const clientId = await this.secrets.get(auth.clientIdRef);
    if (!clientId) {
      return {
        status: "not_configured",
        message: `secret ${auth.clientIdRef} not set (oddjob secrets set ${auth.clientIdRef} ...)`,
      };
    }
    const clientSecret = auth.clientSecretRef
      ? await this.secrets.get(auth.clientSecretRef)
      : undefined;

    const state = randomBytes(16).toString("hex");
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

    const port = await pickEphemeralPort();
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
    });
    if (auth.scopes?.length) params.set("scope", auth.scopes.join(" "));
    if (auth.usePkce !== false) {
      params.set("code_challenge", codeChallenge);
      params.set("code_challenge_method", "S256");
    }
    const authorizeUrl = `${auth.authorizationUrl}?${params.toString()}`;

    const flowPromise = new Promise<ConnectorTokenRecord>((resolve, reject) => {
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
        if (url.pathname !== "/oauth/callback") {
          res.writeHead(404).end("not found");
          return;
        }
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        if (!code || returnedState !== state) {
          res.writeHead(400).end("bad request");
          reject(new Error("oauth callback missing code or state mismatch"));
          server.close();
          this.pending.delete(connectorId);
          return;
        }
        // Exchange code for token.
        (async () => {
          try {
            const body = new URLSearchParams({
              grant_type: "authorization_code",
              code,
              redirect_uri: redirectUri,
              client_id: clientId,
            });
            if (clientSecret) body.set("client_secret", clientSecret);
            if (auth.usePkce !== false) body.set("code_verifier", codeVerifier);
            const resp = await fetch(auth.tokenUrl!, {
              method: "POST",
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body,
            });
            if (!resp.ok) throw new Error(`token exchange failed: ${resp.status}`);
            const tokenJson = (await resp.json()) as TokenResponse;
            const [deploymentId, connectorName] = splitConnectorId(connectorId);
            const record = await this.persistToken(
              connectorId,
              deploymentId,
              connectorName,
              {
                tokenUrl: auth.tokenUrl!,
                clientId,
                clientSecret: clientSecret ?? undefined,
                tokenJson,
                scopes: auth.scopes?.join(" "),
              },
            );
            res
              .writeHead(200, { "content-type": "text/html" })
              .end("<h2>Oddjob: connector authorized.</h2><p>You can close this tab.</p>");
            resolve(record);
          } catch (e) {
            res.writeHead(500).end((e as Error).message);
            reject(e as Error);
          } finally {
            server.close();
            this.pending.delete(connectorId);
          }
        })();
      });
      server.listen(port, "127.0.0.1");
      this.pending.set(connectorId, {
        state,
        codeVerifier,
        codeChallenge,
        redirectUri,
        authorizationUrl: auth.authorizationUrl!,
        tokenUrl: auth.tokenUrl!,
        clientId,
        scopes: auth.scopes,
        resolve,
        reject,
        server,
        port,
      });
      // Hard-cancel after 5 minutes so a stuck flow doesn't leak the listener.
      setTimeout(() => {
        if (this.pending.has(connectorId)) {
          server.close();
          this.pending.delete(connectorId);
          reject(new Error("oauth flow timed out"));
        }
      }, 5 * 60_000);
    });

    // Caller awaits the redirect URL; the flow resolves out-of-band when the
    // user completes the consent screen.
    void flowPromise.catch(() => undefined);
    return { status: "authenticated", redirectUrl: authorizeUrl };
  }

  /** Wait for an in-flight initiateFlow to land. Useful for CLI commands. */
  async awaitCompletion(connectorId: string, timeoutMs = 5 * 60_000): Promise<ConnectorTokenRecord> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!this.pending.has(connectorId)) {
        const rec = await this.state.getConnectorToken(connectorId);
        if (rec) return rec;
        throw new Error(`auth flow ended without a token for ${connectorId}`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`auth flow timeout for ${connectorId}`);
  }

  private openToken(b64: string, aad: string): string {
    return openSealed(
      {
        iv: Buffer.from(b64.split("|")[0]!, "base64"),
        ciphertext: Buffer.from(b64.split("|")[1]!, "base64"),
        tag: Buffer.from(b64.split("|")[2]!, "base64"),
      },
      this.masterKey,
      { aad },
    );
  }

  private sealToken(plaintext: string, aad: string): string {
    const sealed = seal(plaintext, this.masterKey, { aad });
    return [
      sealed.iv.toString("base64"),
      sealed.ciphertext.toString("base64"),
      sealed.tag.toString("base64"),
    ].join("|");
  }

  private async persistToken(
    connectorId: string,
    deploymentId: string,
    connectorName: string,
    args: {
      tokenUrl: string | undefined;
      clientId: string | undefined;
      clientSecret?: string;
      tokenJson: TokenResponse;
      scopes?: string;
      existingRefreshToken?: string;
    },
  ): Promise<ConnectorTokenRecord> {
    const t = args.tokenJson;
    const expiresAt = t.expires_in ? Date.now() + t.expires_in * 1000 : undefined;
    const record: ConnectorTokenRecord = {
      connectorId,
      deploymentId,
      connectorName,
      accessTokenEncrypted: this.sealToken(t.access_token, connectorId),
      refreshTokenEncrypted: t.refresh_token
        ? this.sealToken(t.refresh_token, connectorId)
        : args.existingRefreshToken
        ? this.sealToken(args.existingRefreshToken, connectorId)
        : undefined,
      expiresAt,
      tokenUrl: args.tokenUrl,
      clientId: args.clientId,
      clientSecretEncrypted: args.clientSecret
        ? this.sealToken(args.clientSecret, connectorId)
        : undefined,
      scopes: args.scopes,
      status: "active",
      updatedAt: Date.now(),
    };
    await this.state.upsertConnectorToken(record);
    return record;
  }
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

function splitConnectorId(connectorId: string): [string, string] {
  const idx = connectorId.indexOf(":");
  if (idx === -1) return ["", connectorId];
  return [connectorId.slice(0, idx), connectorId.slice(idx + 1)];
}

async function pickEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("could not pick port")));
      }
    });
    srv.on("error", reject);
  });
}
