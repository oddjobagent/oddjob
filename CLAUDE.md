# oddjob/ workspace

Bun monorepo. 21 packages (`core`, `server`, `cli`, `sdk`, `api-client`, 16 providers) + 1 app (`apps/dashboard`).

## Stack invariants

- **Runtime:** Bun ≥ 1.3 only. `bun:sqlite`, `Bun.serve`, `Bun.spawn` used everywhere.
- **Language:** TypeScript strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` + `allowImportingTsExtensions` (we import `./foo.ts` literally).
- **Tests:** `bun:test` only. Unit tests live next to the file as `*.test.ts`.
- **Type check:** `tsgo` (the native preview). Run `bun run typecheck` from root — it chains `tsgo --noEmit` for backend + `bun run --cwd apps/dashboard typecheck` for the dashboard, because the root tsconfig **does not include `apps/**`** (different lib + paths).
- **Lint/format:** `oxlint` + `oxfmt`. ~32 warnings remain by design (no-await-in-loop in sequential migration runners). 0 errors required.
- **Workspaces:** `packages/*`, `packages/providers/*`, `apps/*`. Workspace deps use `"workspace:*"`.

## Dev workflow

```bash
bun install
bun test                  # 99 tests
bun run typecheck         # tsgo + dashboard tsgo
bun run lint              # oxlint
bun run format            # oxfmt
```

Live dev:
```bash
taskmux restart server    # reload after code change (server runs under taskmux)
```

Build the single binary:
```bash
bun build --compile --outfile=./dist/oddjob ./packages/cli/src/index.ts
./dist/oddjob serve --port 7777
```

## Conventions you'll trip over

- **`*.sql` and `*.html` text imports:** SQL migrations and the dashboard HTML are imported with `import x from "./foo.sql" with { type: "text" }`. Required because `bun build --compile` can't resolve `import.meta.url` filesystem paths inside `/$bunfs/root/`. There's a `*.sql` declaration in each provider (`sql-modules.d.ts`) and `*.html` in `packages/server/src/html-modules.d.ts`.
- **Dashboard `apps/dashboard/src/components/*` use relative imports** (`../lib/utils.ts`), not the `@/` alias from the dashboard's tsconfig. Bun's bundler doesn't read per-package tsconfig paths when invoked from repo root via the CLI.
- **`bun --compile` ignores PostCSS.** Tailwind v4 utilities are pre-compiled by `bunx @tailwindcss/cli` to `apps/dashboard/src/styles.compiled.css`. **That file is checked into git** so the HTML import always resolves at serve time. Don't gitignore it; regenerate via `bun run --cwd apps/dashboard build:css`.
- **Server is run via `taskmux`** (not directly). See root `CLAUDE.md`.
- **citty boolean flags:** `"no-ui"` doesn't bind to `args["no-ui"]` cleanly — citty parses `--no-ui` as the negation of `ui`. Pattern: `args: { ui: { type: "boolean", default: true } }`, then check `args.ui`.
- **Dashboard auth gap (live):** the server doesn't inject a bearer-token meta tag. Localhost no-token mode works fine; non-loopback bearer mode would 401 every request. See STATUS.md for plan.
- **Lazy Proxy in `packages/cli/src/lib/api.ts`** for `api.<ns>.<method>(...)` works for direct calls but breaks on reflection (`Object.keys(api.runs)`, `"list" in api.runs`). Don't reflect on it.
