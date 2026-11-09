# NIGHTSHIFT roadmap status

Updated after every completed phase. This is the single source of truth for "what's actually
done" — if it's not checked off here with a commit hash, it isn't done.

**Current branch:** `feat/nightshift-1.0-complete`
**Baseline commit (main, 0.1.0):** `783787fb21299af5e68b2d37b25a32c5ceab7dff`
**Current phase:** Phase 1 (Profile Manager) — done; next up is the modern CLI visual redesign (see below)

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

Status: **Done**

Implemented: `profile list`, `profile show <id>`, `profile apply <id>`,
`profile import <file> [--overwrite]`, `profile export <id> [--output] [--overwrite]`,
`profile remove <id>`.

- [x] Extended `core/config/store.ts` with `activeProfileId` (`.default(null)` — a 0.1.0
      config file without the field loads fine, treated as `null`). `setActiveTheme` now
      clears `activeProfileId`; new `setActiveProfileAndTheme` sets both atomically.
- [x] `profile apply` reuses `applyThemeFileOnly` (extracted from the former
      `applyThemeToWindowsTerminal`, which is now that function + a config-state update) — one
      backup/verify/rollback implementation, not two. If the NIGHTSHIFT-config write fails
      after the terminal write succeeded, the terminal backup is restored too.
- [x] `profile import`: 64 KB size limit checked before parsing, strict Zod validation, theme-
      existence check, traversal-safe destination via `resolveSafePath`, symlink-destination
      rejection via `assertNotSymlink`, duplicate/`--overwrite` handling, built-in ids never
      overwritable.
- [x] `profile export`: safe destination handling, `--overwrite` protection, symlink check,
      verified to never mutate active config.
- [x] `profile remove`: user profiles only; clears `activeProfileId` if the removed profile
      was active.
- [x] `profile show <id>`.
- [x] Registry extended (not re-implemented) to merge bundled + user profiles; a user profile
      can never shadow a built-in id; `isBuiltinProfileId`/`inspectUserProfilesDirectory` added
      for the import/remove guards and `doctor`.
- [x] Profile schema made `.strict()` — unexpected fields now rejected, not dropped.
- [x] Interactive menu: List/Apply/Import/Export/Remove/Back.
- [x] `status`/`doctor` report active profile and user-profile-directory health.
- [x] Tests: 40 new (unit: schema-strict, config backward-compat, registry anti-shadow;
      integration: 21 import/export/remove cases, 5 apply cases including the config-write-
      failure rollback path; CLI: show + end-to-end import/export/remove/apply via the built
      binary with isolated `LOCALAPPDATA`/`APPDATA`). Full suite: **72/72 pass**, verified by
      running `npm test` immediately before this commit (not a restated/assumed number).
- [x] Typecheck, lint, build all pass after every change in this phase.
- [x] Docs: README, CHANGELOG, SECURITY.md, docs/CONFIGURATION-FORMATS.md updated. Version
      bumped to `0.2.0` in `package.json` (and lockfile synced via `npm install`, no dependency
      changes).
- [x] Committed (`56aa5b3`), pushed to `feat/nightshift-1.0-complete`, PR opened against `main`:
      https://github.com/amarjaleelbanbhan/nightshift/pull/1 (not merged, awaiting review).

## Additional directive — modern CLI visual redesign

Received mid-Phase-1 (session 4): a design directive requesting a full TUI visual identity —
design system, modern component library evaluation (Ink vs. @clack/prompts vs. current
chalk+@inquirer/prompts), per-theme component styling, keyboard nav, resize handling.

**Deliberately deferred to its own phase, after Phase 1 finishes**, for a concrete reason:
Ink renders via a React component tree, which is a different execution model than our current
print-and-exit commands. That's a real architectural decision — it also affects the existing
CLI integration tests, which assert on plain stdout strings from the built binary. Evaluating
it properly (not reflexively) means finishing the Profile Manager data/command layer first, so
the redesign has stable commands to wire into rather than redesigning around functionality
that's still changing underneath it.

## Phases 2–16

Status: **Not started.** See "why phases are not all attempted at once" above. Will be
picked up one at a time, each updating this file with its own real status before the next
begins.
