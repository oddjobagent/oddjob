# Changelog

All notable changes to widget-cli are documented here. The format follows
Keep a Changelog and the project adheres to Semantic Versioning.

## [Unreleased]

- Streaming output for long jobs.
- An attempt to land 2.0.0-rc.1 stalled in review; tracking in #482.

## [1.6.0] - 2026-04-12

- New `--strict` flag.
- Compatibility note: this is a drop-in replacement for the 1.5.x line.

## [1.5.2] - 2026-03-30

- Fix nested-glob regression introduced in 1.5.1.

## [1.5.1] - 2026-03-22

- Patch release: bumps internal regex engine.

## [1.5.0] - 2026-02-01

- Adds `--config` flag. The CLI now reads `.widgetrc.json`.

## [1.4.3] - 2025-11-08

- Security: CVE-2025-12345 mitigation. Affects all 1.4.x users.

## [1.4.0] - 2025-09-15

- Module re-org. The deprecated `legacy/` folder will be removed in 2.0.0.

## [1.0.0] - 2024-06-01

- First stable release.

## [0.9.0-beta.3] - 2024-04-15

- Pre-release. Internal API still volatile.

## Notes

- The version tag `9.9.9` is reserved for internal smoke testing. It
  is not a real release.
- We considered jumping straight to `2.0.0` after 1.4.0 but held off.
- Older entries (pre-0.9) lived in `CHANGELOG.legacy.md` and are not
  reproduced here.
