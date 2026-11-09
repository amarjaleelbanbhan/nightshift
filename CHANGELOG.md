# Changelog

All notable changes to this project are documented here.

## [0.1.0] - 2026-11-09

Initial development release. See README.md for a precise list of what's implemented,
partially implemented, and planned.

### Added

- CLI foundation (`nightshift --version`, `--help`, `init`, `status`, `doctor`).
- Theme engine with Zod-validated schema and four built-in themes: Ghost Protocol, Monolith,
  Redline, Deep Space.
- `theme list`, `theme preview`, `theme apply`.
- Windows Terminal adapter: capability detection, settings merge preserving unrelated keys,
  backup-before-write with automatic rollback on verification failure.
- `backup create`, `backup list`, `restore <id>`.
- Minimal profile schema and `profile list` (bundled profiles only; apply/import are planned).
- Interactive home menu (`nightshift` with no arguments) distinguishing implemented sections
  from planned ones.
- Unit, integration, and security test suites (path traversal, malformed imports, backup
  restore, Windows Terminal settings merge).
