import type { AuthFlowResult, AuthStatus, Connector } from "../types/connector.ts";
import type { Provider } from "./base.ts";

export interface AuthProvider extends Provider {
  getToken(connectorId: string): Promise<string>;
  initiateFlow(connectorId: string, connector: Connector): Promise<AuthFlowResult>;
  revokeToken(connectorId: string): Promise<void>;
  status(connectorId: string): Promise<AuthStatus>;
  /**
   * Returns a fresh access token. Refreshes against the OAuth2 token endpoint
   * when (a) the token is past `expiresAt - refreshSkew`, OR (b) `force` is
   * true (used after the resource server returned 401 despite an
   * unexpired-looking token).
   */
  refreshIfNeeded(connectorId: string, opts?: { force?: boolean }): Promise<string>;
}
