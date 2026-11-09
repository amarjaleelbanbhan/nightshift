# Security

## Reporting a vulnerability

Open a private security advisory on GitHub ("Security" tab → "Report a vulnerability") or open
an issue if that's unavailable. Do not include exploit details in a public issue.

## What NIGHTSHIFT does today

- Validates every theme and profile (built-in or user-supplied) against a Zod schema before
  using it. Malformed or unexpected fields are rejected, not coerced.
- Resolves every user- or file-supplied path (user theme filenames, backup ids) through
  `resolveSafePath`, which rejects anything that resolves outside its intended directory
  (`src/security/paths.ts`). This blocks `../../`-style traversal.
- Writes configuration files atomically (temp file + rename) so a crash mid-write cannot
  leave a half-written `settings.json`.
- Backs up Windows Terminal's `settings.json` before every mutating `theme apply`, verifies
  the write afterward, and automatically restores the backup if verification fails.
- Never executes code from a theme, profile, or any imported file. Themes and profiles are
  pure declarative JSON data — there is no script execution path.
- Does not collect, log, or transmit telemetry, credentials, or environment variables.
- Profile import (`profile import <file>`) enforces a 64 KB file-size limit before parsing,
  rejects anything that isn't a regular file, requires the referenced theme to exist, rejects
  unexpected JSON fields (strict schema), and will never let an imported file overwrite a
  built-in profile id regardless of `--overwrite`. The write destination is checked for
  symlinks before writing (`assertNotSymlink`).
- Profile export never overwrites an existing destination file without `--overwrite`, checks
  the destination isn't a symlink first, and never mutates NIGHTSHIFT's active-state config.
- `profile apply`/`theme apply` restore the pre-apply backup not just when the terminal write
  fails, but also when the subsequent NIGHTSHIFT config update fails — the two are never left
  disagreeing with each other.

## Known limitations

- The marketplace, widget packs, and shell-snippet installation described in the long-term
  product vision are **not implemented** in this release — there is no code path for any of
  them, so their respective risks (supply-chain trust, unapproved shell execution) do not yet
  apply, but also haven't been tested.
- Backup/restore has unit and integration test coverage but has only been exercised on
  Windows 11 with a single Windows Terminal installation layout per test run.
- `theme apply` rewrites `settings.json` with 4-space JSON formatting; it does not preserve
  the user's original key ordering or formatting style, only the data.
- There is no code-signing or integrity verification for themes/profiles yet, since there is
  no remote registry to fetch them from in this release.

This project has not had an external security audit. Treat it as early-stage software.
