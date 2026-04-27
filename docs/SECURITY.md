# Security model — v1

This is the v1 threat model for Oddjob. It documents what each layer
enforces, what it does not, and where the gaps are deferred to v1.1+. The
15h work item will refine this with the lethal-trifecta caveats and the
detailed local-strict / docker / remote-vm postures.

## Layers

### Environments

Every Run executes inside an Environment (`config.provider.service`). Trust
tier dictates how strongly the boundary holds:

| Tier           | Provider examples       | What blocks the agent from the host                        |
| -------------- | ----------------------- | ---------------------------------------------------------- |
| `trusted`      | `process` (env-process) | Nothing. Same uid, same fs, same network. Dev only.        |
| `local-strict` | `seatbelt`, `bwrap`     | OS-level fs scoping + network namespace (where supported). |
| `container`    | `docker` (env-docker)   | OCI namespacing — fs, pid, net.                            |
| `remote-vm`    | `daytona` (env-daytona) | Firecracker MicroVM.                                       |

The setup gate (`oddjob setup`) refuses to complete without ≥1 environment
service registered. The hard-default `default` environment row is auto-
created and points at the platform-appropriate service. Operators can
upgrade defaults via `oddjob environment set-default`.

### Egress proxy / credential broker (v1)

Every Run optionally starts a per-Run localhost proxy that the
EnvironmentSession's HTTPS_PROXY env var points at. The proxy enforces:

- **Per-run authentication.** Random 32-byte token in the proxy URL
  (`http://oddjob:<token>@127.0.0.1:port`). Every request must carry
  matching `Proxy-Authorization`; mismatch → 407. Closes the same-host
  port-scan exfil vector.
- **Host allowlist.** Engine-required hosts (LLM provider base URL + HTTP
  MCP server hostnames from blueprint connectors) ∪ `env.allowed_hosts`.
  Gate runs on the parsed URL hostname (NOT the Host header) for plain
  HTTP, and on the `CONNECT host:port` line for HTTPS.
- **DNS-resolve + IP-pin.** At allowlist-check time we resolve the host
  to an IP, validate against an SSRF deny-list (RFC1918, loopback,
  link-local incl. `169.254.169.254` cloud-metadata, IPv6 ULA, IPv4
  multicast, IPv4 reserved), then connect to the pinned IP. Closes the
  DNS-rebinding window between allowlist check and upstream connect.
- **Port allowlist.** Default `[80, 443]`. Blocks SSH/SMTP/Redis/etc.
  exfil channels via CONNECT to non-HTTP ports.
- **Concurrency cap.** ≤ 16 simultaneous CONNECT tunnels per Run.
- **Body size caps.** 64 KiB rewritable, 1 MiB total request body, 8 MiB
  response body. Header cap 64 KiB. Body deadline 5s.
- **Transfer-Encoding: chunked rejected** with 411 (we don't parse
  chunked; agents needing streaming use HTTPS).
- **Duplicate Host headers rejected** with 400 (HTTP smuggling vector).
- **Request body scrubbing (plain HTTP).** After secret rewriting, the
  rewritten body is scanned for known vendor token shapes. Hit → 422.
- **Response body scrubbing (plain HTTP).** Upstream response body is
  scanned for token shapes before forwarding to the agent. Catches the
  echo-endpoint exfil pattern (POST a secret, allowed host mirrors it
  back).
- **URL token scan.** Request URL (path + query) checked for vendor
  token shapes. Catches `?token=sk-...` exfil.
- **Log redaction.** All log lines containing URLs scrub vendor token
  patterns to `[REDACTED]` before emit.

The token-shape catalog covers OpenAI (`sk-...`), Anthropic
(`sk-ant-...`), GitHub (`ghp_/gho_/ghu_/ghs_/ghr_/github_pat_`), Slack
(`xoxb-/xoxp-/xapp-/xwfp-`), and Daytona (`dtn_...`). Add patterns to
`TOKEN_SHAPES` in `core/security/proxy.ts` as new vendors are integrated.

### What the v1 broker does NOT do

- **HTTPS body inspection / secret injection over TLS.** v1 handles HTTPS
  via raw `CONNECT` tunneling only. The encrypted body passes through
  opaque — the proxy CANNOT see secrets, scan bodies, or rewrite headers
  inside the TLS stream. **`${secret:NAME}` placeholders sent over HTTPS
  reach upstream LITERALLY.** This means for v1, agents that want secret
  injection over HTTPS must either (a) use the placeholder over a plain
  HTTP allowlisted endpoint that internally proxies to HTTPS, or (b) wait
  for v1.1 TLS termination.

  v1.1 plan: per-Run CA generation, TLS-terminating proxy, cert injected
  into the sandbox trust store via `NODE_EXTRA_CA_CERTS` (already wired
  through `EgressProxyHandle.caPem` — empty in v1, populated in v1.1).

- **Block raw socket calls bypassing HTTPS_PROXY.** The proxy only sees
  what the agent's HTTP libraries route through it. Raw sockets bypass
  entirely. Real network containment is the **environment provider's**
  job (local-strict / container / remote-vm). The `process` provider is
  trusted-tier and explicitly does NOT enforce networking — it sets
  `HTTPS_PROXY/NO_PROXY=""/NODE_USE_ENV_PROXY=1` for clients that
  cooperate, but offers zero containment for clients that don't.

### Sandbox env vars

Sandbox env continues to receive credentials via process env vars
(today). The credential broker pattern (secrets stay outside the sandbox,
proxy injects them at egress) only fully works for plain HTTP in v1; it
becomes the default once v1.1 ships TLS termination.

The `env-process` plugin uses a **curated host-env allowlist** —
PATH/HOME/USER/SHELL/TMPDIR/LANG/LC_ALL only. Host AWS keys, SSH agent
sockets, etc. are NOT inherited. Per-blueprint secrets are layered on top
via `EnvironmentRunConfig.env`.

## Lethal trifecta caveats (Willison)

The broker addresses parts of the egress half of the Willison "lethal
trifecta" model:

- **Untrusted instructions** (the agent itself): not addressed by the
  broker. The agent decides what to send; the broker just gates where it
  can go.
- **Sensitive data access** (in the run): partially mitigated for plain
  HTTP via secret rewriting. NOT mitigated over HTTPS (v1 limitation).
- **External communication** (egress to attacker-controlled host): host
  allowlist + DNS pin + IP allowlist all gate this. Effective.

Result: the broker does NOT solve prompt injection, but it does
significantly raise the cost of exfiltration when the agent is compromised
— attacker has to land on an allowlisted host's hostname (DNS-pinned to a
public IP), use an allowed port, and (for plain HTTP) avoid token-shape
patterns in the URL/body/response. This is the right v1 posture.

## Recommendations for blueprint authors

- **Always declare `[networking]` in your environment.** The default
  `unrestricted` skips the broker entirely. Use `type = "limited"` and
  list the hosts your blueprint actually needs.
- **Don't put real tokens in tool args.** Use `${secret:NAME}` and let
  the broker substitute (works for plain HTTP). For HTTPS, set the
  secret as an env var on the connector — `EnvironmentRunConfig.env`
  layers below `${secret:...}` placeholders that the connector resolves
  before sending.
- **Treat env-process as dev-only.** Deploy with `seatbelt` (Mac),
  `bwrap` (Linux), `docker`, or `daytona` for any production workload.
