export interface ServerOptions {
  host: string;
  port: number;
  maxWorkers: number;
  bearerToken?: string;
}

export interface ServerHandle {
  url: string;
  stop(): Promise<void>;
}

export async function startServer(_options: ServerOptions): Promise<ServerHandle> {
  throw new Error("startServer: not implemented (Phase 5)");
}
