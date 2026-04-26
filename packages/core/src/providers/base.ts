export interface Provider {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthy(): Promise<boolean>;
}
