export interface RunOutput {
  finalText: string;
  structuredOutput?: Record<string, unknown>;
  artifacts?: RunArtifact[];
}

export interface RunArtifact {
  key: string;
  contentType: string;
  size: number;
  meta?: Record<string, string>;
}
