import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { defineCommand } from "citty";

const TEMPLATE = (name: string, author: string) => `name = "${name}"
version = "0.1.0"
description = "TODO: describe what this agent does"
author = "${author}"
tags = []
license = "MIT"

model = "openrouter/anthropic/claude-sonnet-4"
prompt = """
You are an agent that does X.

When the user gives you input, you should...
"""

[memory]
store = "kv"
retention = "30d"

[secrets]
openrouter = "OPENROUTER_API_KEY"
`;

const DEPLOY = `blueprint = "./blueprint.toml"

[[trigger]]
type = "manual"

[[channel]]
type = "console"

[limits]
duration = "5m"
tool_calls = 50
budget = 0.50
`;

export default defineCommand({
  meta: { name: "init", description: "Scaffold a new blueprint directory." },
  args: {
    name: { type: "positional", required: true, description: "Blueprint name (a-z, 0-9, hyphen)" },
    author: { type: "string", default: "demo", description: "Namespace / author" },
    dir: { type: "string", default: ".", description: "Parent directory" },
  },
  async run({ args }) {
    const dir = resolve(args.dir, args.name);
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, "scripts"), { recursive: true });
    await mkdir(join(dir, "skills"), { recursive: true });
    await writeFile(join(dir, "blueprint.toml"), TEMPLATE(args.name, args.author));
    await writeFile(join(dir, "deploy.toml"), DEPLOY);
    await writeFile(join(dir, ".gitignore"), "node_modules/\n.env\n");
    process.stdout.write(`scaffolded ${dir}\n`);
  },
});
