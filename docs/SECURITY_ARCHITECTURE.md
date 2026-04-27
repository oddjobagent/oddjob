# Security architecture

How Oddjob isolates AI agents from the host, controls what they can reach,
and where the trust boundaries actually sit. This is the architecture
companion to [`SECURITY.md`](./SECURITY.md) — that doc describes the v1
threat model and what's deferred; this doc explains how the pieces fit
together.

---

## Trust model in one diagram

```
┌──────────────────────────────────────────────────────────────────┐
│ HOST (the operator's machine running `oddjob serve`)             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Oddjob daemon (trusted)                                    │  │
│  │   - SecretsProvider (AES-256-GCM, OS keyring master key)   │  │
│  │   - Plugin registry (model providers + env providers)      │  │
│  │   - Worker pool (lease-based dispatch)                     │  │
│  │   - Per-Run egress proxy on 127.0.0.1:<random>             │  │
│  └────────────────┬───────────────────────────┬───────────────┘  │
│                   │ spawns one Run            │ writes egress    │
│                   ▼                           │ logs             │
│  ┌────────────────────────────────────┐       │                  │
│  │ Environment session (untrusted)    │       │                  │
│  │   provider = process | seatbelt |  │       │                  │
│  │              bwrap | docker |      │       │                  │
│  │              daytona               │       │                  │
│  │                                    │       │                  │
│  │   ┌─────────────────────────────┐  │       │                  │
│  │   │ agent loop + tool calls     │  │       ▼                  │
│  │   │  (LLM-controlled code path) │  │   run_logs (SQLite)      │
│  │   │                             │  │                          │
│  │   │  HTTPS_PROXY=…127.0.0.1:N   │  │                          │
│  │   └──────────────┬──────────────┘  │                          │
│  └──────────────────┼─────────────────┘                          │
│                     │ outbound HTTP/S                            │
│                     ▼                                            │
│  ┌────────────────────────────────────┐                          │
│  │ Egress proxy (gate)                │                          │
│  │  - per-Run Proxy-Auth token        │                          │
│  │  - host allowlist                  │                          │
│  │  - DNS resolve + IP-pin            │                          │
│  │  - reject RFC1918/loopback/cloud-  │                          │
│  │    metadata IPs                    │                          │
│  │  - port allowlist (80/443 default) │                          │
│  │  - plain HTTP: secret rewrite +    │                          │
│  │    body/URL/response token scrub   │                          │
│  │  - HTTPS: CONNECT firewall only    │                          │
│  └────────────────┬───────────────────┘                          │
│                   │                                              │
└───────────────────┼──────────────────────────────────────────────┘
                    │
                    ▼
              upstream HTTPS APIs
              (LLM provider, MCP servers, allowlisted webhooks)
```

---

## The four trust tiers

Every Run is bound to exactly one Environment, which selects exactly one
EnvironmentService (provider). The `trustTier` field on each service
describes how strongly the host/sandbox boundary holds.

| Tier           | Bundled provider                       | What enforces the boundary                                                                | Gaps (operator must accept or upgrade)                                              |
| -------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `trusted`      | `process` (env-process)                | Curated host-env allowlist only (PATH/HOME/USER/SHELL/TMPDIR/LANG/LC_ALL).                | Same uid/fs/network as the daemon. Dev only.                                        |
| `local-strict` | `seatbelt` (Mac), `bwrap` (Linux)      | OS sandbox: filesystem write-scoped to workdir + meta; reads denylisted on exfil paths.   | Network restricted only via egress proxy (kernel-level allow); raw sockets bypass.  |
| `container`    | `docker` (env-docker)                  | OCI namespacing — mount, pid, net. Container is `--rm` per Run.                           | Default bridge network — operator may want `--network=oddjob-egress` custom bridge. |
| `remote-vm`    | `daytona` (env-daytona)                | Firecracker MicroVM with kernel isolation. Total fs/net/proc isolation from host.        | Vendor trust (Daytona infra). API key required. Cold start ~90ms.                   |

Selection cascade (per Run):

1. `deployments.environment_inline_json` (deploy.toml inline override) — wins if present.
2. `deployments.environment_id` (deploy.toml `environment = "<id>"` reference) — looked up in `environments` table.
3. `engine_settings.default_environment_id` — set by `oddjob env set-default`.
4. Hard-default `default` Environment row — auto-created at `oddjob setup` based on platform (`seatbelt` on Mac, `bwrap` on Linux, `process` with warning otherwise).

The `setup` step refuses to complete unless ≥1 EnvironmentService is registered AND a default Environment row exists. There is no path that runs an agent with zero environment.

---

## How a Run actually executes

Worker pool invariant: `worker.processRun()` does these steps in order, with finally-blocks ensuring cleanup on every failure mode:

```
1. Resolve Environment (cascade above) → { envRecord, providerService }
2. Load EnvironmentProvider via providerService.create(credential)
3. If env.config.networking.type === "limited":
     a. Compute allowedHosts ∪ engineRequiredHosts(llm, blueprint)
        (engine_required = LLM provider baseUrl host + HTTP MCP server hosts)
     b. startEgressProxy({ allowedHosts, secrets, blockTokenShapes: true, log })
     c. Receive { url, caPem, stop } — caPem is empty in v1, reserved for v1.1 MITM
4. provider.spawn({ config: env.config, workdir, env: filteredEnv,
                    timeoutMs, signal, egressProxy: { url, caPem } })
   - filteredEnv passes through SecretsProvider lookups for blueprint.secrets refs
   - provider injects HTTPS_PROXY / HTTP_PROXY / NO_PROXY="" / NODE_USE_ENV_PROXY=1 /
     NODE_EXTRA_CA_CERTS into the spawned shell when egressProxy is set
5. Build harness tools (built-ins routed through EnvironmentSession.exec/writeFile/readFile;
   web_fetch/web_search proxied; MCP tools dispatched to mcp-client)
6. runAgentLoop(messages, systemPrompt, tools, signal)
7. Persist Run row with environmentSnapshot = { id?, source, serviceId, trustTier }
   (immutable provenance — survives later env edits or deletions)
8. Finally: session.kill(), egressProxy.stop(), MCP clients close
```

The `environmentSnapshot` field on every Run row is the **audit trail** —
even after an Environment is edited or the engine default changes, every
historical Run is provably traceable back to which provider executed it.

---

## The egress proxy in detail

The proxy is the credential broker. It runs on `127.0.0.1:<random>` and
binds for the lifetime of the Run only. Code: `packages/core/src/security/proxy.ts`.

### Per-Run authentication

The proxy URL contains a Basic-auth token (`http://oddjob:<random32bytes>@127.0.0.1:<port>`),
generated at proxy-start. Every request must carry matching `Proxy-Authorization`;
mismatch returns 407. This closes the same-host port-scan exfil vector
where another local process discovers the proxy port.

### Allowlist gate

Allowed hosts = engine-required hosts ∪ `env.networking.allowed_hosts`.
Engine-required is automatically:

- The LLM provider's `baseUrl` hostname (so the agent can always reach its model)
- Each HTTP/SSE MCP server host from `blueprint.connectors`

Plain HTTP: gate runs on the parsed URL hostname (NOT the Host header — Host header injection is rejected via duplicate-header check).

HTTPS: gate runs on the `CONNECT host:port` line.

### DNS-resolve + IP-pin

After the hostname allowlist passes, the proxy resolves the host once
via `node:dns/promises.lookup`, then validates the resolved IP against an
SSRF deny-list (`isPrivateOrSensitiveIP`):

- IPv4 RFC1918: `10/8`, `172.16/12`, `192.168/16`
- Loopback: `127/8` (and `::1`)
- Link-local: `169.254/16` (incl. `169.254.169.254` AWS/GCP/Azure metadata)
- Multicast / reserved
- IPv6 ULA / IPv4-mapped private

The proxy then connects to the **pinned IP**, not the original hostname.
This closes DNS rebinding: an attacker who briefly resolves an
allowlisted hostname to `169.254.169.254` between the allowlist check
and `Bun.connect`'s own resolution can't escape.

Test seam `allowPrivateIps: true` exists for unit tests against fake
loopback upstreams; production posture is `allowPrivateIps: false`
(verified by an explicit inverse test).

### Port allowlist

Default `[80, 443]`. Configurable per proxy. Blocks CONNECT to `:22`,
`:25`, `:6379`, `:3306`, etc. — closes "use the egress allowlist to
reach an internal SSH bastion or DB" exfil patterns.

### Resource limits

- 16 concurrent CONNECT tunnels per Run (429 on overflow)
- 64 KiB header cap (431 on overflow)
- 1 MiB request body cap (413)
- 8 MiB response body cap
- 5 s body deadline (408)
- Transfer-Encoding: chunked rejected (411)

### Plain-HTTP secret rewriting

Agent code can put `${secret:NAME}` placeholders in headers or the
request body. The proxy's body buffer scans for placeholders, looks up
each via `SecretsProvider.get(name)`, substitutes, then forwards.
Pattern: `\$\{secret:([A-Za-z0-9_.-]+)\}`. Cloudflare AI Gateway model.

The agent never sees the real key — the placeholder is what's in the
sandbox env. v1 limitation: HTTPS bodies are opaque to the proxy (no
MITM), so this only works for plain HTTP.

### Token-shape scrubber

After secret rewriting (NOT before — order matters), the rewritten body
is scanned for known vendor token shapes. On hit: 422 + log. Patterns:

- `sk-[A-Za-z0-9_-]{20,}` (OpenAI)
- `sk-ant-[A-Za-z0-9_-]{20,}` (Anthropic)
- `(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}` (GitHub PATs)
- `github_pat_[A-Za-z0-9_]{20,}` (GitHub fine-grained)
- `(xoxb|xoxp|xapp|xwfp)-[A-Za-z0-9-]{20,}` (Slack)
- `dtn_[a-f0-9]{40,}` (Daytona)

URL path/query is also scanned (catches `?token=sk-...` exfil).

Response bodies (plain HTTP) are scanned before forwarding to the agent
— catches the **echo-endpoint exfil**: agent posts a real secret to an
allowed host that mirrors it back, would normally bypass all filters.

### Log redaction

Every log emit (`run_logs` table, dashboard log tail) passes URLs
through `redactString()` which replaces vendor token patterns with
`[REDACTED]`. Authorization headers are logged as `<present>` not value.

### What it doesn't do

Documented in [`SECURITY.md`](./SECURITY.md). The big one:

- **HTTPS body inspection / secret injection over TLS.** v1 handles
  HTTPS via raw CONNECT only. Encrypted body passes opaque. So
  `${secret:...}` placeholders sent over HTTPS reach upstream literally,
  scrubber doesn't see HTTPS bodies, response scrub is HTTP-only.

- **Block raw sockets bypassing HTTPS_PROXY.** The proxy only sees what
  the agent's HTTP libraries route through it. Raw sockets bypass
  entirely. Real network containment is the **environment provider's**
  job — `process` doesn't enforce, `local-strict` partially enforces
  (kernel-level allow-net + proxy as convention), `container` and
  `remote-vm` enforce via network namespace.

---

## Secrets

Encrypted at rest in `secrets.db` (separate SQLite file from `oddjob.db`)
via AES-256-GCM. Master key sourced from OS keyring (macOS Keychain via
`security`, Linux `secret-tool`/libsecret) with `ODDJOB_MASTER_KEY` env
fallback. The encryption uses **secret name as Additional Authenticated
Data (AAD)** — a ciphertext copied to a different name fails decryption,
closing the swap class.

Secrets reach the sandbox via three paths today:

1. **Env injection** at provider.spawn — `EnvironmentRunConfig.env` is
   resolved against blueprint.secrets references, secret values pulled
   via SecretsProvider, set as env vars on the spawned process.
   Env-process applies the curated host-env allowlist on top so OS
   secrets (AWS keys, SSH agent socket, etc.) are NOT inherited.
2. **MCP connector auth** — for HTTP MCP, `Authorization: Bearer
   ${secret:NAME}` is resolved client-side before the request. For
   stdio MCP, the secret is set as an env var on the spawned MCP server.
3. **Plain-HTTP placeholder rewrite** at the proxy — `${secret:NAME}` in
   the agent's outbound request body or headers.

v1.1 deferred: full TLS-terminating proxy with per-Run CA + cert
injection (`NODE_EXTRA_CA_CERTS` already wired through
`EgressProxyHandle.caPem` — empty in v1, populated in v1.1). That
deprecates path #1 entirely for HTTPS-using connectors.

---

## Setup gate + plugin loader

`oddjob setup` cannot complete without:

1. ≥1 EnvironmentService registered (the four bundled plugins satisfy
   this automatically — process is always available).
2. ≥1 Environment record (auto-created as `default` pointing at the
   platform-appropriate service).

Plugin loader paths:

- **Bundled plugins** — statically imported in `apps/cli/src/lib/runtime.ts`.
  Survive `bun --compile`. v1 ships `env-process`, `env-local-strict`,
  `env-docker`, `env-daytona` plus the four model-provider plugins
  (openai, anthropic, openrouter, llama-local) plus channels-core +
  builtin-tools.
- **Side-loaded plugins** — `~/.oddjob/plugins/<slug>/` dirs with
  `oddjob-plugin.toml` manifest. Loader uses absolute-path `import()` which
  resolves outside `/$bunfs/root/`. Trust model: same Bun process, full
  `process.env` + disk access — same trust as `~/.oddjob/config.toml`.

Removing the last EnvironmentService plugin causes the next setup pass
to fail with `cannot disable: no other environment service available`.

---

## Threat model boundaries

Three actors, three distinct trust postures:

**Operator** (the human running `oddjob serve`): fully trusted. Owns the
master key, can read all secrets, can install any plugin, can change any
config. The product does not defend against an evil operator.

**Blueprint author** (writes `blueprint.toml` and bundled scripts):
semi-trusted. Trusted with prompt content + script logic + tool
allowlist + which connectors to use. NOT trusted to bypass the egress
proxy or write outside the sandbox. The blueprint is content the
operator chose to deploy.

**Agent / LLM** (runtime decision-maker inside the sandbox): UNTRUSTED.
Treats every model output as if it could be prompt-injected. Every tool
call routes through the EnvironmentSession. Every outbound HTTP routes
through the egress proxy. Even allowlisted hosts and even "safe"-looking
tool args are filtered.

The boundaries that matter:

| Boundary                         | Enforced by                                                        |
| -------------------------------- | ------------------------------------------------------------------ |
| Operator → Blueprint Author      | Code review of pulled blueprints (operator's responsibility).      |
| Blueprint Author → Agent (host)  | EnvironmentProvider tier (process/local-strict/container/remote-vm). |
| Agent → outbound network         | Egress proxy (allowlist + IP-pin + token scrub + log redact).      |
| Agent → host filesystem          | EnvironmentSession.writeFile/readFile + provider's fs scoping.     |
| Agent → host process tree        | EnvironmentSession.exec runs in sandboxed shell.                   |
| Agent → host secrets             | Curated env-allowlist; secrets only injected per blueprint config. |
| Run history → operator (audit)   | Immutable `runs.environmentSnapshot` + redacted `run_logs`.        |

What's NOT defended against:

- **Prompt injection of the agent.** The architecture does not prevent
  the agent from being convinced to do bad things. It prevents the
  consequences of bad decisions from reaching beyond the boundaries
  above.
- **Operator-controlled exfiltration.** If the operator allowlists a
  webhook the attacker controls, or installs a malicious plugin,
  nothing here helps.
- **Side-channel leaks.** Timing, packet sizes, DNS lookups (via the
  proxy's resolver). Low-bandwidth but real.

---

## Verification & E2E

Phase 15 exit criteria validated end-to-end against the running server
(team-lead context, not just engineer-claimed):

```
$ curl /api/v1/environments/providers
process         trusted        available=True
seatbelt        local-strict   available=True
bwrap           local-strict   available=False  (Linux only)
appcontainer    local-strict   available=False  (Win only, stub)
docker          container      available=True
daytona         remote-vm      available=False  (no credential)

$ oddjob env credential add daytona --api-key dtn_...
credential daytona/default added

$ oddjob env set-default seatbelt-default
$ oddjob run echo --follow --input '{"text":"e2e-test"}'
status: complete
→ run.environmentSnapshot = { id: seatbelt-default,
                              source: engine-default,
                              serviceId: seatbelt,
                              trustTier: local-strict }

$ oddjob env set-default daytona-default
$ oddjob run echo --follow --input '{"text":"daytona-e2e"}'
status: complete
→ run.environmentSnapshot = { id: daytona-default,
                              source: engine-default,
                              serviceId: daytona,
                              trustTier: remote-vm }
```

Both runs landed status=complete with correct provenance persisted on
the Run row. Cost: $0.002 (Haiku via OpenRouter) for seatbelt; Daytona
spun a real Firecracker MicroVM, executed the agent loop inside it,
returned, killed the sandbox.

The `jobs/env-demo` blueprint exists for ongoing CI-style verification
(host-env isolation + allowlisted egress + python interpreter) but
exercises the same machinery this section verified by hand.

Built-in tool routing (bash/read/write/edit/grep/find/ls/python_repl/
javascript_repl through `EnvironmentSession`) verified via
`packages/core/src/agent/builtin-tools/environment-isolation.test.ts`
which asserts `bash` runs in the per-Run tempdir, not host process.cwd.

---

## v1 → v1.1 roadmap

Tracked in `SECURITY.md`. Headline items:

- **TLS-terminating proxy** — per-Run ephemeral CA, MITM HTTPS, full
  body inspection over TLS. Replaces env-var secret injection for
  HTTPS-using connectors. The `caPem` field is already wired through
  the `EgressProxyHandle` and consumed by every environment provider.
- **Native Windows AppContainer** — replaces the WSL2 fallback in
  `env-local-strict`'s `appcontainer` service. Stub-throws today.
- **Per-Run cgroups** for `env-docker` — CPU/memory/IO limits at the
  container, not just the soft tool/budget limits in the agent loop.
- **Connector OAuth lifecycle** for MCP — token refresh, re-auth
  notification (planned in Phase 9b, separate from Phase 15).
- **Output-channel attestation** — sign run outputs with a per-Run key
  so a downstream consumer can verify the run's environment provenance
  without trusting the operator's audit log.
