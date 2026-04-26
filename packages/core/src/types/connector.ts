export type Connector = StdioConnector | HttpConnector;

export interface ConnectorBase {
  auth: ConnectorAuth;
  scopes?: string[];
  tools?: string[];
  env?: Record<string, string>;
}

export interface StdioConnector extends ConnectorBase {
  transport: "stdio";
  command: string;
  args?: string[];
}

export interface HttpConnector extends ConnectorBase {
  transport: "http" | "sse";
  server: string;
}

export type ConnectorAuth =
  | { kind: "none" }
  | { kind: "api_key"; headerName?: string; secretRef: string }
  | { kind: "bearer"; secretRef: string }
  | {
      kind: "oauth2";
      clientIdRef?: string;
      clientSecretRef?: string;
      authorizationUrl?: string;
      tokenUrl?: string;
      scopes?: string[];
      usePkce?: boolean;
    };

export type AuthStatus = "authenticated" | "expired" | "reauth_needed" | "not_configured";

export interface AuthFlowResult {
  status: AuthStatus;
  redirectUrl?: string;
  message?: string;
}
