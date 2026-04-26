# Demo blueprints

Local sample blueprints used for development smoke tests. Each subdirectory contains a `blueprint.toml` and a `deploy.toml` that you can validate, push, deploy, and run.

| Job                 | Tests                                              |
| ------------------- | -------------------------------------------------- |
| `echo`              | Minimal blueprint, manual trigger, console channel |
| `word-count`        | Script-as-tool, parse stdin / write stdout         |
| `research`          | Pure LLM, webhook + manual triggers                |
| `structured-output` | `output_schema` JSON Schema enforcement            |

Run from the workspace root:

```bash
oddjob validate jobs/echo
oddjob run jobs/echo
```
