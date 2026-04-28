import { createHash } from "node:crypto";

import { parse as parseToml } from "smol-toml";

import type {
  Blueprint,
  BlueprintId,
  BlueprintMemory,
  BlueprintOutcomes,
  BlueprintOutputSchema,
} from "../types/blueprint.ts";
import type {
  Connector,
  ConnectorAuth,
  HttpConnector,
  StdioConnector,
} from "../types/connector.ts";
import { type BlueprintIssue, BlueprintParseError } from "./errors.ts";
import {
  type BlueprintRaw,
  type BlueprintSchemaIssue,
  type ConnectorAuthRaw,
  type ConnectorRaw,
  validateBlueprintRaw,
} from "./schema.ts";

export interface ParseOptions {
  path: string;
}

export function parseBlueprint(source: string, options: ParseOptions): Blueprint {
  let toml: unknown;
  try {
    toml = parseToml(source);
  } catch (err) {
    throw new BlueprintParseError(`Failed to parse TOML: ${(err as Error).message}`, err);
  }

  const result = validateBlueprintRaw(toml);
  if (!result.ok || !result.data) {
    throw new BlueprintParseError(
      `Blueprint schema invalid:\n${formatIssues(result.issues)}`,
      result.issues,
    );
  }

  const contentHash = sha256(source);
  return normalizeBlueprint(result.data, options, contentHash, source);
}

function normalizeBlueprint(
  raw: BlueprintRaw,
  options: ParseOptions,
  contentHash: string,
  sourceToml: string,
): Blueprint {
  const connectors: Record<string, Connector> = {};
  for (const [key, value] of Object.entries(raw.connectors)) {
    connectors[key] = normalizeConnector(key, value);
  }

  const memory: BlueprintMemory = {
    store: raw.memory?.store ?? "kv",
    retention: raw.memory?.retention ?? "30d",
  };

  const out = resolveSchemaSource(raw.output_schema, "output_schema");
  const inp = resolveSchemaSource(raw.input_schema, "input_schema");
  const outcomes: BlueprintOutcomes | undefined = raw.outcomes
    ? {
        success: raw.outcomes.success,
        warning: raw.outcomes.warning,
        error: raw.outcomes.error,
        warningTools: raw.outcomes.warning_tools,
        errorTools: raw.outcomes.error_tools,
        maxRetries: raw.outcomes.max_retries,
        retryBackoffMs: raw.outcomes.retry_backoff_ms,
        grader: raw.outcomes.grader
          ? {
              rubricText: raw.outcomes.grader.rubric_text,
              rubricFile: raw.outcomes.grader.rubric_file,
              model: raw.outcomes.grader.model,
              maxIterations: raw.outcomes.grader.max_iterations,
              onVerdict: raw.outcomes.grader.on_verdict,
            }
          : undefined,
      }
    : undefined;

  const id = `${raw.author}/${raw.name}` as BlueprintId;

  const toolNames: string[] = [];
  const toolPolicies: Record<string, { confirm?: boolean }> = {};
  for (const entry of raw.tools) {
    if (typeof entry === "string") {
      toolNames.push(entry);
    } else {
      toolNames.push(entry.name);
      if (entry.confirm) toolPolicies[entry.name] = { confirm: true };
    }
  }

  return {
    id,
    name: raw.name,
    namespace: raw.author,
    version: raw.version,
    schemaVersion: raw.schema_version,
    description: raw.description,
    author: raw.author,
    tags: raw.tags,
    license: raw.license,
    model: raw.model,
    prompt: raw.prompt,
    requires: raw.requires?.roles?.length ? { roles: raw.requires.roles } : undefined,
    tools: toolNames,
    toolPolicies: Object.keys(toolPolicies).length > 0 ? toolPolicies : undefined,
    skills: raw.skills,
    connectors,
    scripts: raw.scripts,
    memory,
    secrets: raw.secrets,
    failOnToolError: raw.fail_on_tool_error,
    outputSchema: out.schema,
    outputSchemaFile: out.file,
    inputSchema: inp.schema,
    inputSchemaFile: inp.file,
    outcomes,
    path: options.path,
    contentHash,
    sourceToml,
  };
}

function normalizeConnector(name: string, raw: ConnectorRaw): Connector {
  const auth = normalizeAuth(raw.auth);
  const scopes = raw.scopes;
  const tools = raw.tools;
  const env = raw.env;

  if ("command" in raw && raw.command !== undefined) {
    const stdio: StdioConnector = {
      transport: "stdio",
      command: raw.command,
      args: raw.args,
      auth,
      scopes,
      tools,
      env,
    };
    return stdio;
  }

  if ("server" in raw && raw.server !== undefined) {
    const http: HttpConnector = {
      transport: raw.transport === "sse" ? "sse" : "http",
      server: raw.server,
      auth,
      scopes,
      tools,
      env,
    };
    return http;
  }

  throw new BlueprintParseError(`connector ${name}: must have server or command`);
}

function normalizeAuth(raw: ConnectorAuthRaw | undefined): ConnectorAuth {
  if (raw === undefined) return { kind: "none" };
  if (typeof raw === "string") {
    if (raw === "none") return { kind: "none" };
    if (raw === "api_key" || raw === "bearer") {
      throw new BlueprintParseError(
        `auth = "${raw}" requires a secret_ref. Use a table form: { kind = "${raw}", secret_ref = "..." }`,
      );
    }
    if (raw === "oauth2") return { kind: "oauth2" };
    return { kind: "none" };
  }
  switch (raw.kind) {
    case "none":
      return { kind: "none" };
    case "api_key":
      return {
        kind: "api_key",
        headerName: raw.header_name,
        secretRef: raw.secret_ref,
      };
    case "bearer":
      return { kind: "bearer", secretRef: raw.secret_ref };
    case "oauth2":
      return {
        kind: "oauth2",
        clientIdRef: raw.client_id_ref,
        clientSecretRef: raw.client_secret_ref,
        authorizationUrl: raw.authorization_url,
        tokenUrl: raw.token_url,
        scopes: raw.scopes,
        usePkce: raw.use_pkce,
      };
  }
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function resolveSchemaSource(
  raw: { json_schema?: Record<string, unknown> | string; json_schema_file?: string } | undefined,
  where: string,
): { schema?: BlueprintOutputSchema; file?: string } {
  if (!raw) return {};
  if (raw.json_schema !== undefined) {
    const inline = raw.json_schema;
    const schema =
      typeof inline === "string" ? parseJsonStrict(inline, `${where}.json_schema`) : inline;
    return { schema: { type: "json-schema", schema } };
  }
  if (raw.json_schema_file) return { file: raw.json_schema_file };
  return {};
}

function parseJsonStrict(source: string, where: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (err) {
    throw new BlueprintParseError(
      `${where}: invalid JSON heredoc — ${(err as Error).message}`,
      err,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BlueprintParseError(`${where}: must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function formatIssues(issues: BlueprintSchemaIssue[]): string {
  return issues.map((i) => `  - ${i.path || "(root)"}: ${i.message}`).join("\n");
}
