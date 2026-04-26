# Demo blueprints

Local sample blueprints used for development smoke tests. Each subdirectory contains a `blueprint.toml`, an optional `deploy.toml`, and supporting scripts/skills/connectors.

| Job                 | Demonstrates                                                         |
| ------------------- | -------------------------------------------------------------------- |
| `echo`              | Minimal blueprint, manual trigger, console channel                   |
| `word-count`        | Script-as-tool with `count_words.schema.json` sidecar                |
| `research`          | Pure LLM, console + webhook channel                                  |
| `structured-output` | `output_schema` JSON Schema enforcement                              |
| `file-lister`       | MCP filesystem connector (`@modelcontextprotocol/server-filesystem`) |
| `with-skill`        | SKILL.md progressive disclosure via `skill_load` builtin             |

## Run from the workspace root

```bash
# one-time
oddjob setup

# start the server (separate terminal)
oddjob serve

# push + deploy + run a blueprint
oddjob push jobs/echo
oddjob deploy jobs/echo --name echo-prod
oddjob run echo-prod --input "hello"

# logs + output
oddjob logs <RUN_ID>
oddjob output <RUN_ID>
```
