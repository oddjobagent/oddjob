# oddjob/runtime base image

Default image used by the `env-docker` environment plugin.

## Build locally

```bash
docker build -t oddjob/runtime:latest -f docker/oddjob-runtime/Dockerfile docker/oddjob-runtime
```

This phase does NOT push to a registry — the env-docker plugin assumes the
image is available locally. CI / production deployments should mirror this
to a private registry of their choice and override `[config.image]` in the
Environment record.

Contents (~150 MB):

- `debian:bookworm-slim`
- `bun` (latest, installed to `/usr/local/bin/bun`)
- `python3` + `python3-pip`
- `curl`, `git`, `ca-certificates`, `unzip`
