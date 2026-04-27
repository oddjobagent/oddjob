import { describe, expect, test } from "bun:test";

import { BlueprintParseError } from "../blueprint/errors.ts";
import { parseEnvironment } from "./parse.ts";

describe("parseEnvironment", () => {
  test("minimal local env", () => {
    const env = parseEnvironment(`
id = "default-local"

[config]
type = "local"
`);
    expect(env.id).toBe("default-local");
    expect(env.config.type).toBe("local");
    expect(env.config.networking).toBeUndefined();
  });

  test("cloud env with packages and unrestricted networking", () => {
    const env = parseEnvironment(`
id = "data-analysis"
description = "pandas + numpy"

[config]
type = "cloud"

[config.packages]
pip = ["pandas", "numpy"]
npm = ["express"]

[config.networking]
type = "unrestricted"
`);
    expect(env.config.packages?.pip).toEqual(["pandas", "numpy"]);
    expect(env.config.packages?.npm).toEqual(["express"]);
    expect(env.config.networking).toEqual({ type: "unrestricted" });
  });

  test("limited networking with allowed_hosts", () => {
    const env = parseEnvironment(`
id = "locked-down"

[config]
type = "cloud"

[config.networking]
type = "limited"
allowed_hosts = ["api.example.com"]
allow_mcp_servers = true
`);
    expect(env.config.networking).toEqual({
      type: "limited",
      allowedHosts: ["api.example.com"],
      allowMcpServers: true,
      allowPackageManagers: undefined,
    });
  });

  test("id must match pattern (rejects underscores, capitals)", () => {
    expect(() => parseEnvironment(`id = "Bad_Env"\n[config]\ntype = "local"\n`)).toThrow(
      BlueprintParseError,
    );
  });

  test("namespaced id like ns/name is allowed", () => {
    const env = parseEnvironment(`
id = "nineprimes/seo-toolkit"
[config]
type = "cloud"
`);
    expect(env.id).toBe("nineprimes/seo-toolkit");
  });

  test("rejects unknown networking type", () => {
    expect(() =>
      parseEnvironment(`
id = "x"
[config]
type = "cloud"
[config.networking]
type = "wide-open"
`),
    ).toThrow(BlueprintParseError);
  });
});
