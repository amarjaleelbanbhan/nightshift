# Changelog

All notable changes to this project are documented here.

## [0.2.0] - 2026-11-09

### Added

- Profile Manager: `profile show <id>`, `profile apply <id>`, `profile import <file>`,
  `profile export <id>`, `profile remove <id>`. `profile apply` reuses the same backup →
  write → verify → rollback engine as `theme apply` (no second implementation).
- `activeProfileId` added to NIGHTSHIFT's config schema, additive and backward-compatible:
  a 0.1.0 config file without the field loads with `activeProfileId: null`. Applying a theme
  standalone clears `activeProfileId`; applying a profile sets both fields atomically in one
  write.
- Profile registry now also loads user-imported profiles from `%APPDATA%\nightshift\profiles\`
  and merges them with bundled ones; a user profile can never shadow a built-in id.
- Profile schema is now strict — unexpected fields are rejected rather than silently dropped.
- `status`/`doctor` report active profile and user-profile-directory health (valid count,
  invalid/unreadable files).
- Interactive Profile Manager menu: list/apply/import/export/remove.
- Investigated and documented (not blindly "fixed") the `npm audit` Zod advisory
  (`GHSA-mrhx-c7xc-m3w5`) — see `docs/SECURITY-MODEL.md`.
- `docs/ARCHITECTURE.md`, `docs/PLATFORM-COMPATIBILITY.md`, `docs/SECURITY-MODEL.md`,
  `docs/CONFIGURATION-FORMATS.md`, `ROADMAP_STATUS.md`.
- 40 new tests (unit, import/export, apply integration, CLI) covering the above.

### Fixed

- `theme apply`'s backup-creation step is now wrapped so a backup failure returns a clean
  error instead of an uncaught exception.

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
