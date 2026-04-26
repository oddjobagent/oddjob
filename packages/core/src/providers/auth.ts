import type { AuthFlowResult, AuthStatus, Connector } from "../types/connector.ts";
import type { Provider } from "./base.ts";

export interface AuthProvider extends Provider {
  getToken(connectorId: string): Promise<string>;
  initiateFlow(connectorId: string, connector: Connector): Promise<AuthFlowResult>;
  revokeToken(connectorId: string): Promise<void>;
  status(connectorId: string): Promise<AuthStatus>;
  refreshIfNeeded(connectorId: string): Promise<string>;
}
