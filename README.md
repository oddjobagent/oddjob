# Oddjob

Task-specific AI agent runtime — define an agent declaratively in a TOML "Blueprint", run it on a schedule, webhook, or manual trigger via a single `oddjob serve` daemon.

> **Status:** v0.0.0 — pre-alpha. Trusted local blueprints only. See [`plans/SPEC.md`](../plans/SPEC.md) for the full design and [`plans/STATUS.md`](../plans/STATUS.md) for what's implemented vs. what's left.

---

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- An LLM API key (one of):
  - `OPENROUTER_API_KEY` (recommended — gateway to Anthropic/OpenAI/Google/etc.)
  - `ANTHROPIC_API_KEY`
- macOS or Linux (Windows untested)
- Optional: `npx` on `PATH` if you want to use stdio MCP connectors like `@modelcontextprotocol/server-filesystem`

---

## Install (from source)

```bash
git clone <this-repo> oddjob && cd oddjob
bun install
```

You'll run the CLI from the repo for now via `bun apps/cli/src/index.ts <cmd>`. A `bun build --compile` produces a single 63 MB binary at `dist/oddjob` if you want a standalone executable:

```bash
bun build --compile --outfile=./dist/oddjob ./apps/cli/src/index.ts
./dist/oddjob --help
```

For convenience, alias the CLI in your shell:

```bash
alias oddjob='bun /absolute/path/to/oddjob/apps/cli/src/index.ts'
```

The remaining steps assume `oddjob` resolves to the CLI.

---

## Walkthrough

### 1. First-time setup

```bash
export OPENROUTER_API_KEY=sk-or-...    # or ANTHROPIC_API_KEY
oddjob setup
```

Creates `~/.oddjob/`, generates a 256-bit master key, writes `~/.oddjob/config.toml`. The master key is stored in macOS Keychain / Linux libsecret if available, otherwise via the `ODDJOB_MASTER_KEY` env var.

### 2. Start the server

In a separate terminal:

```bash
oddjob serve
# oddjob serving on http://127.0.0.1:7777
```

Server binds to localhost by default. To bind to `0.0.0.0` you must configure a bearer token in `~/.oddjob/config.toml` first — the server refuses to start non-loopback without one.

### 3. Run a demo blueprint

```bash
oddjob validate jobs/echo
oddjob push jobs/echo
oddjob deploy jobs/echo --name echo-prod
oddjob run echo-prod --input "Reply with one word: aye"
```

You should see something like:

```
status: complete
aye
```

### 4. Inspect runs

```bash
oddjob list runs --limit 5
oddjob logs <RUN_ID>
oddjob output <RUN_ID>
oddjob status
```

### 5. Try the other demo blueprints

| Job                      | Demonstrates                                          | Live needs      |
| ------------------------ | ----------------------------------------------------- | --------------- |
| `jobs/echo`              | Minimal blueprint, manual trigger, console channel    | LLM key         |
| `jobs/word-count`        | Script-as-tool with `count_words.schema.json` sidecar | LLM key         |
| `jobs/research`          | Pure LLM Q&A, console channel                         | LLM key         |
| `jobs/structured-output` | `output_schema` JSON Schema extraction                | LLM key         |
| `jobs/file-lister`       | Real stdio MCP filesystem connector                   | LLM key + `npx` |
| `jobs/with-skill`        | SKILL.md progressive disclosure via `skill_load`      | LLM key         |

Push and run any of them the same way:

```bash
oddjob push jobs/file-lister
oddjob deploy jobs/file-lister --name fs-demo
oddjob run fs-demo --input "List the first 5 files in /tmp."
```

### 6. Cron triggers

Edit a `deploy.toml` to add a cron trigger before deploying:

```toml
[[trigger]]
type = "cron"
schedule = "0 8 * * *"
timezone = "Australia/Sydney"
```

Cron schedules survive server restart; the worker pool reclaims any leases left by a previous crashed worker.

### 7. Webhook triggers

```toml
[[trigger]]
type = "webhook"
[trigger.auth]
kind = "hmac"
secret_ref = "MY_HMAC_SECRET"
header = "x-signature"
```

Then:

```bash
oddjob secrets set MY_HMAC_SECRET 'long-random-string'
curl -X POST http://127.0.0.1:7777/webhooks/<namespace>/<name> \
  -H 'x-signature: <hex-sha256-of-body>' \
  -d '{"key":"value"}'
```

The webhook handler enqueues a run; the body becomes `input` for the agent.

---

## Authoring a new blueprint

```bash
oddjob init my-agent --author yourname
cd my-agent
# edit blueprint.toml: prompt, model, scripts, connectors, skills
oddjob validate .
oddjob push .
oddjob deploy . --name my-agent-prod
oddjob run my-agent-prod --input "..."
```

A blueprint directory looks like:

```
my-agent/
├── blueprint.toml         agent definition: model, prompt, tools, connectors, skills, secrets
├── deploy.toml            optional: triggers, channels, limits
├── scripts/               .ts/.sh/.py scripts the agent can call as tools
│   ├── parse.ts
│   └── parse.schema.json  optional sidecar schema (much better LLM tool-use)
└── skills/
    └── my-skill/
        └── SKILL.md       YAML frontmatter (name, description) + body
```

See `plans/SPEC.md` §4 for the full TOML schema reference.

---

## Built-in tools

The harness ships 12 built-in tools. **Opt-in per blueprint** — list them in `tools = [...]`. Empty / omitted = none.

| Tool              | What it does                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `bash`            | Shell command (subprocess in cwd of blueprint dir)                                              |
| `read`            | Read a file (text + image) with truncation                                                      |
| `write`           | Create / overwrite a file                                                                       |
| `edit`            | Surgical string replacement in a file                                                           |
| `grep`            | Pattern search via ripgrep                                                                      |
| `find`            | Glob respecting `.gitignore`                                                                    |
| `ls`              | Directory listing                                                                               |
| `web_fetch`       | HTTPS GET → markdown (HTML auto-converted). SSRF guard on private IPs. 5 MB body cap.           |
| `web_search`      | Top-N results via configured provider (brave / tavily / searxng). Engine config, not blueprint. |
| `javascript_repl` | `bun -e <code>` subprocess. Top-level await supported. 10 s default timeout.                    |
| `python_repl`     | `python3 -c <code>` subprocess. Requires python3 on PATH. 30 s default timeout.                 |
| `datetime`        | Current date/time. Optional IANA timezone + format (`iso` / `rfc2822` / `unix` / `human`).      |

Read/write/edit/grep/find/ls/bash come from `@mariozechner/pi-coding-agent` — same shape Claude Code uses. The REPLs and web\_\* are oddjob-specific.

**Sandbox posture:** v1 tools run as host processes — _not_ a security boundary. Same trust model as `bash`. Cloud sandboxes (E2B / Modal / Daytona / Vercel Sandbox) land in Phase 15 as a pluggable `SandboxProvider`.

Example:

```toml
# blueprint.toml
tools = ["bash", "web_fetch", "python_repl"]
prompt = """
Fetch the URL the user gives you, then count its length in Python and report.
"""
```

Configure web_search (optional) in `~/.oddjob/config.toml`:

```toml
[builtin_tools.web_search]
provider = "brave"           # or "tavily" or "searxng"
api_key_secret = "BRAVE_API_KEY"   # name of secret in the vault
# or: api_key = "literal-key"

[builtin_tools.web_fetch]
max_body_mb = 5
private_ips_allowed = false  # set true to allow 127.0.0.1 etc.
```

Try the demo:

```bash
oddjob push jobs/builtin-demo
oddjob deploy jobs/builtin-demo
oddjob run builtin-demo --input "https://example.com" --follow
```

---

## Channels

Output destinations for run results. Configure in `deploy.toml`:

```toml
[[channel]]
type = "console"

[[channel]]
type = "slack"
target = "#alerts"
webhook_url_secret_ref = "SLACK_WEBHOOK_URL"

[[channel]]
type = "email"
to = "you@example.com"
resend_api_key_secret_ref = "RESEND_API_KEY"

[[channel]]
type = "webhook"
url = "https://your.app/oddjob-callback"
hmac_secret_ref = "CALLBACK_HMAC"
```

`slack` supports incoming-webhook URLs or bot tokens. `email` uses Resend (SMTP via nodemailer is TBD).

---

## Environments & sandboxing

Every Run executes inside an Environment. An Environment is a reusable
config (image, packages, networking, resources) plus a choice of provider
that determines the trust tier. Environments live in the `environments`
table and are referenced by deployments via `environment = "<id>"` in
`deploy.toml`. A deployment can also override fields inline.

### Trust tiers

| Tier           | Bundled provider                        | Use for                                       |
| -------------- | --------------------------------------- | --------------------------------------------- |
| `trusted`      | `process` (env-process)                 | Dev only — same uid/fs/network as the daemon. |
| `local-strict` | `seatbelt` (Mac), `bwrap` (Linux)       | Default. OS-level fs scoping.                 |
| `container`    | `docker` (env-docker)                   | Self-host with Docker daemon available.       |
| `remote-vm`    | `daytona` (env-daytona)                 | Hosted Oddjob, untrusted blueprints.          |

`oddjob setup` picks the platform-appropriate default automatically
(seatbelt on Mac, bwrap on Linux). Switch via:

```
oddjob env set-default <env-id>
oddjob env providers       # list registered services + available() status
oddjob env credential add daytona --api-key dtn_...   # for remote providers
```

### Egress policy

Each Environment can declare a `[networking]` allowlist:

```toml
[config.networking]
type = "limited"
allowed_hosts = ["openrouter.ai", "api.github.com"]
```

When set, the runtime starts a per-Run localhost proxy that gates outbound
traffic to the allowlist (DNS-resolved + IP-pinned to defeat rebinding,
RFC1918/loopback/cloud-metadata blocked) and rewrites `${secret:NAME}`
placeholders before forwarding (plain HTTP only — see SECURITY.md for the
HTTPS limitation deferred to v1.1).

Engine-required hosts (the LLM provider's base URL + any HTTP MCP server
URLs declared in the blueprint's connectors) are auto-merged into the
allowlist so a deployment can't lock the agent out of its own model.

See [`docs/SECURITY.md`](docs/SECURITY.md) for the full v1 threat model
and the explicit list of what the broker does and does not enforce.

---

## CLI reference

```
oddjob setup                          first-time setup
oddjob serve [--host H] [--port P]    start the daemon

oddjob init <name> [--author X]       scaffold a blueprint dir
oddjob validate [path]                validate a blueprint dir
oddjob push [path]                    upload a blueprint
oddjob deploy [path] [--name X]       create a deployment

oddjob run <deployment-name>          trigger and stream a run
  [--input X | --stdin] [--no-follow]

oddjob list runs|deployments|blueprints  [--limit N] [--deployment ID]
oddjob status                         server status
oddjob logs <run-id> [--tail]         stream run logs
oddjob output <run-id> [--json]       show finalText + structuredOutput

oddjob secrets set <NAME> <VALUE> [--stdin]
oddjob secrets list
oddjob secrets delete <NAME>

oddjob skills add <user/repo[/path] | git URL | local path>  [--name X]
oddjob skills list
oddjob skills remove <name>
```

`pull`, `undeploy`, `mcp`, `channel`, `auth`, `inspect` are stubbed — see [STATUS.md](../plans/STATUS.md).

---

## Development

```bash
bun install
bun test                # 92 tests
bun run typecheck       # tsgo --noEmit
bun run lint            # oxlint
bun run format          # oxfmt

# Live MCP integration tests (needs npx + network)
ODDJOB_LIVE_MCP=1 bun test packages/providers/mcp-client
```

Repo layout:

```
packages/
├── core/                  types, blueprint pipeline, agent loop, skills
├── server/                Bun.serve API + worker pool + webhook ingress
├── cli/                   oddjob CLI (citty)
├── sdk/                   re-exports for plugin authors
└── providers/
    ├── llm-pi             pi-ai wrapper (OpenRouter + native providers)
    ├── llm-anthropic      (stub)
    ├── sandbox-process    Bun.spawn + tempdir
    ├── state-sqlite       blueprints, deployments, runs, KV memory
    ├── queue-sqlite       leased queue with crash recovery
    ├── queue-memory       in-process queue for tests
    ├── secrets-sqlite     AES-256-GCM with name-as-AAD + keyring
    ├── logging-sqlite     run logs
    ├── scheduler-croner   cron triggers
    ├── mcp-client         stdio + Streamable HTTP + SSE
    ├── channel-console    stdout
    ├── channel-slack      Slack webhooks + bot tokens
    ├── channel-email      Resend
    ├── channel-webhook    generic POST + HMAC
    ├── storage-local      (stub)
    └── auth-local         (stub — OAuth lifecycle Phase 9b)
```

---

## License

MIT — see [LICENSE](./LICENSE).
