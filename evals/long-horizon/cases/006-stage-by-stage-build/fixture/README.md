# Stage-by-stage CLI build

Build a tiny `greet` CLI in three stages. Each stage has a test that
should pass before moving on.

## Stage 1 — parse flags

Implement `parseFlags(argv: string[])` in `src/flags.ts`. It accepts:

- `--name <string>` — required.
- `--upper` — boolean, default `false`.

Returns `{ name: string; upper: boolean }` or throws on missing/invalid
input. See `src/flags.test.ts` for exact shapes.

## Stage 2 — load config

Implement `loadConfig(path: string)` in `src/config.ts`. Reads a JSON
file `{ greeting: string }` and returns it. If the file is missing,
returns `{ greeting: "Hello" }`. See `src/config.test.ts`.

## Stage 3 — wire it together

Implement `run(argv, configPath)` in `src/run.ts`. Combines flags +
config and returns the final string `<greeting>, <name>!`. If
`upper` is true, uppercases the result. See `src/run.test.ts`.
