# Batch rename

Rename the function `getUser` to `fetchUser` across the project.
The test in `src/main.test.ts` imports the new name; it currently
fails because no file exports `fetchUser`.

After your changes:

- No source file (`src/**/*.ts`) should contain the identifier
  `getUser` anywhere — definitions, imports, or call sites.
- `bun test` should pass.

Eight `.ts` files under `src/` (one of which is a test). Find them all.
