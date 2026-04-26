export class BlueprintParseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "BlueprintParseError";
  }
}

export class BlueprintValidationError extends Error {
  readonly issues: BlueprintIssue[];
  constructor(issues: BlueprintIssue[]) {
    super(`Blueprint validation failed: ${issues.map((i) => i.message).join("; ")}`);
    this.name = "BlueprintValidationError";
    this.issues = issues;
  }
}

export interface BlueprintIssue {
  path: string;
  message: string;
}
