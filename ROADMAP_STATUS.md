# NIGHTSHIFT roadmap status

Updated after every completed phase. This is the single source of truth for "what's actually
done" — if it's not checked off here with a commit hash, it isn't done.

**Current branch:** `feat/nightshift-1.0-complete`
**Baseline commit (main, 0.1.0):** `783787fb21299af5e68b2d37b25a32c5ceab7dff`
**Current phase:** Phase 1 (Profile Manager) — in progress

## Why phases are not all attempted at once

Phases 2–16 of the full 1.0.0 directive include work this session explicitly will not do
without a separate check-in, because the directive's own safety rules require it:

- **Font installation (Phase 3)** writes files to the user's font directory — a
  "user-approved action" per the directive's own classification. Needs a specific proposal
  shown before any write.
- **Starship / shell-profile integration (Phase 6)** edits `Microsoft.PowerShell_profile.ps1`
  / `.bashrc` / `.zshrc` — the original 0.1.0 directive and this one both require showing the
  exact diff and getting explicit approval before touching shell startup files.
- **Linux/macOS adapters (Phase 9)** cannot be tested on this machine (Windows 11 only). Code
  without verification on the target OS would violate "do not claim these adapters are
  implemented until tested."
- **NIGHTSHIFT Studio (Phase 10)** is a local React+Vite app with its own HTTP server and
  security surface (CSRF, origin validation, session tokens) — a substantial build in its own
  right, not an incremental add to the CLI.
- **Marketplace (Phase 11)** requires a second real GitHub repository (a static registry) with
  actual hosted, hash-verified assets — not something to fabricate inside this repo.

Each of these gets its own phase, its own tests, and its own commit when it's actually
attempted — not a stub.

## Phase 0 — Baseline and security audit

Status: **Done** (this session, before Phase 1 commit)

- `git status` clean at baseline commit `783787f` on `main` before branching.
- `npm ci`: 196 packages, clean.
- `npm test`: 32/32 pass.
- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npm run build`: pass.
- `npm audit`: 10 advisories — investigated, not blindly patched. See
  `docs/SECURITY-MODEL.md` for the Zod `GHSA-mrhx-c7xc-m3w5` investigation (concluded: does
  not apply to our Zod 3.x usage, no array validation in our schemas, no 3.x patch exists
  because 3.x isn't the affected branch). Remaining 9 are devDependencies only (test/lint
  toolchain), confirmed absent from the published package via `npm pack --dry-run`.
- Created `docs/ARCHITECTURE.md`, `docs/PLATFORM-COMPATIBILITY.md`, `docs/SECURITY-MODEL.md`,
  `docs/CONFIGURATION-FORMATS.md`, this file.
- Created branch `feat/nightshift-1.0-complete`.

## Phase 1 — 0.2.0 Profile Manager

Status: **In progress**

Target commands: `profile list`, `profile show <id>`, `profile apply <id>`,
`profile import <file>`, `profile export <id> [--output]`, `profile remove <id>`.

- [ ] Extend `core/config/store.ts` with `activeProfileId` (backward-compatible with 0.1.0
      config files missing the field).
- [ ] `profile apply` reusing `applyThemeToWindowsTerminal` (no second theme engine).
- [ ] `profile import` with size limit, schema validation, traversal/symlink protection,
      duplicate/overwrite rules.
- [ ] `profile export` with safe destination handling.
- [ ] `profile remove` (user profiles only).
- [ ] `profile show <id>`.
- [ ] Interactive menu updated.
- [ ] Tests: unit, import/export, apply integration, CLI.
- [ ] Docs + CHANGELOG + version bump to 0.2.0.
- [ ] Commit, push, open PR (not merged).

## Phases 2–16

Status: **Not started.** See "why phases are not all attempted at once" above. Will be
picked up one at a time, each updating this file with its own real status before the next
begins.
