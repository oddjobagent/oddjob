# packages/cli

`oddjob` CLI built with citty. Commands are individual files in `src/commands/`.

## Layout

```
src/
├── index.ts           citty root with subCommand registry
├── commands/          one file per command
└── lib/
    ├── api.ts         lazy-proxy wrapper around @oddjob/api-client
    ├── config.ts      ~/.oddjob/config.toml + ODDJOB_HOME + ODDJOB_SERVER overrides
    └── runtime.ts     buildRuntime(cfg) instantiates the full provider stack for `serve`
```

## Implemented commands

`setup`, `serve`, `init`, `validate`, `push`, `deploy`, `run`, `list`, `status`, `logs`, `output`, `secrets`, `skills`.

Stubs (still throw "not implemented"): `pull`, `undeploy`, `mcp`, `channel`, `auth`, `inspect`. See STATUS.md P1.

## Gotchas

- **Lazy `Proxy` on `api.<ns>`**: each property access constructs the api on demand so config changes between calls are honored. Works for `api.runs.list()`. **Breaks** on reflection (`Object.keys(api.runs)`, `"list" in api.runs`, `await api.runs`). Don't introspect.
- **`--no-ui` flag in `serve`:** declared as `args: { ui: { type: "boolean", default: true } }`. citty parses `--no-ui` as the negation. Read `args.ui` (boolean), not `args["no-ui"]` (always false-y).
- **Static dashboard import** at the top of `commands/serve.ts` (`import dashboardHtml from "../../../../apps/dashboard/src/index.html"`). Static, not dynamic, because `bun build --compile` needs static imports to embed the HTML bundle. Removing the import is the future "headless build" toggle.
- **`oddjob run --follow`** polls `/api/v1/runs/:id` and tolerates 404 for the first ~500ms because the worker may not have inserted the Run row yet.
