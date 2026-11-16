# NIGHTSHIFT roadmap status

Updated after every completed phase. This is the single source of truth for "what's actually
done" — if it's not checked off here with a commit hash, it isn't done. Phase numbers below
follow the current (most detailed) 1.0.0 directive: Phase 0 = verify foundation, Phase 1 =
modern CLI redesign, Phase 2 = automatic setup, Phase 3 = font manager, Phase 4 = theme engine
completion, Phase 5 = ASCII Art Studio, Phase 6 = shell integrations, Phase 7 = widget engine,
Phase 8 = Claude Code integration, Phase 9 = cross-platform adapters, Phase 10 = Studio,
Phase 11 = marketplace, Phase 12 = additional customization, Phase 13 = security/reliability,
Phase 14 = testing/CI, Phase 15 = documentation, Phase 16 = release prep.

**Current branch:** `feat/nightshift-coverage-docs`
**Merged foundation:** the 1.0.0 hardening cycle, PRs #2, #24 and #25, merged to `main` at
commit `cf2df3f`
**Current phase:** Phase 2 and the theme-engine portion of Phase 4 are **done**; Phase 3 (font
manager) is **partially done** — detection, plus a copy-only `font install` that does not write
the font registry key and does not download. Phase 15 (documentation) is in progress on this
branch. See the per-phase sections below.
**Release version:** still `0.2.0` in `package.json`. Whether this cycle ships as `0.3.0` or
`1.0.0` is an open maintainer decision (issue #9), and `CHANGELOG.md` is deliberately blocked on
it rather than guessing.

## Authorship audit (this session)

Checked PR #1's description and the last several `main` commit messages for any AI
co-author/attribution text. None found — no cleanup was needed. This check will be repeated
for every future PR before it's opened, not just retroactively.

## Why phases are not all attempted at once

- **Font installation (Phase 3)** writes files to the user's font directory — a
  "user-approved action." It now ships *with* that proposal shown before any write (issue #15),
  reusing `setup`'s structure. What still did not ship is the registry write that completes a
  Windows font install and any download, both for reasons recorded in the Phase 3 section.
- **Starship / shell-profile integration (Phase 6)** edits shell startup files — requires
  showing the exact diff and getting explicit approval first.
- **Linux/macOS adapters (Phase 9)** cannot be tested on this machine (Windows 11 only).
- **NIGHTSHIFT Studio (Phase 10)** is a local React+Vite app with its own HTTP server and
  security surface — a substantial build in its own right.
- **Marketplace (Phase 11)** requires a second real GitHub repository with actual hosted,
  hash-verified assets.

Each gets its own phase, its own tests, and its own commit when actually attempted.

## Phase 0 — Verify the merged foundation

Status: **Done**

- Confirmed PR #1 merge status via `gh pr view 1`: `MERGED` at `2026-11-09T19:10:18Z`.
- Fetched and fast-forwarded local `main` to `origin/main` (`783787f` → `ac223d6`).
- Re-ran the full quality gate on merged `main`: `npm ci`, typecheck, lint, build, test — all
  pass, **72/72 tests**.
- Manually ran `node dist/index.js profile list` on merged `main` to confirm Profile Manager
  is actually present and working, not just reported as such.
- Created `feat/nightshift-1.0.0` from updated `main` (no prior branch of that name existed).

## Phase 1 — Modern CLI redesign

Status: **Done for this increment** (see "Not yet done" below for what's left)

### Library evaluation

| Library | Decision | Why |
|---|---|---|
| `@clack/prompts` | **Adopted**, replaces `@inquirer/prompts` | Only one file (`home.ts`) used inquirer. Clack's connected left-bar visual language (intro/select/outro) gives a distinct, recognizable identity instead of the generic list-prompt look most tutorial CLIs share. Scoped swap of the interactive layer only — no command logic touched. |
| `cli-table3` | **Adopted** | Structured list output (theme/profile/backup lists, doctor checks) instead of manual `padEnd()` string building. |
| `boxen` | **Adopted**, one-shot command headers only | Used for the `status` panel. Deliberately *not* used inside the interactive flow — clack already has its own `box`/`note` with a matching visual language there, and mixing two different border styles in the same screen would look inconsistent, not premium. |
| `strip-ansi` | **Added as a direct dependency** | Was already present transitively (via boxen); formalized since `table.ts` imports it directly for width measurement. |
| `ink` | **Not adopted** | React component-tree rendering is a different execution model than this CLI's print-and-exit commands, and would require rewriting every command's output plus the existing CLI integration tests (which assert on plain stdout from the built binary). Not justified for a CLI this size; revisit only if a genuinely live-updating view (e.g. a real-time widget dashboard) is built later. |
| `ora` | **Not adopted** | No operation in the current codebase is slow enough to need a spinner (file I/O only). Add when font download or marketplace network operations exist. |
| `gradient-string` | **Not adopted** | The directive itself asks for "restrained accent colors," not gradients. Decorative text gradients are exactly the kind of effect called out to avoid. |

All additions are MIT-licensed, actively maintained, and introduced **zero new `npm audit`
findings** (verified: same 10 findings before and after, all devDependency/Zod, see
`docs/SECURITY-MODEL.md`).

### What was built

- `src/cli/ui/colors.ts` — semantic color tokens derived from the *active theme* (falls back to
  Ghost Protocol's palette pre-init), so the CLI's accent color actually changes with the
  user's theme instead of being hardcoded.
- `src/cli/ui/table.ts` — width-aware table rendering. Whichever column has the longest actual
  content gets the terminal's remaining width and word-wraps; every other column is capped at
  32 chars. This replaces an earlier version that let a long Windows Terminal settings path
  stretch the whole table past a 120-char cap with no wrapping at all — caught and fixed by
  actually running `status`/`doctor` against this machine's real (long) settings path, not
  assumed correct from the code.
- `src/cli/ui/panel.ts` — bordered panel for one-shot command headers (boxen).
- `src/cli/ui/prompts.ts` — `@clack/prompts` wrapper: Escape and Ctrl+C both produce clack's
  same cancellation signal (it doesn't distinguish the two keys), so both are treated as "back
  one level" in a submenu / "exit" at the top level, rather than inventing distinct key
  handling the library doesn't actually expose.
- `src/banners/startup.ts` rewritten: `renderStatusPanel` (boxen panel for `status`) and
  `renderMasthead` (short string for clack's `intro()`) replace the old two-line ASCII
  wordmark banner.
- Interactive home screen reorganized into the requested grouping: **Workspace** (dashboard,
  doctor, quick-apply-a-theme), **Customization** (Theme Studio, Profile Manager, ASCII Art
  Studio*, Widgets*), **Integrations** (Terminal Manager*, Shell Manager*, Claude Code*),
  **System** (Setup*, Fonts*, Backups, Settings). (`*` = planned, shown with a hint and a
  `log.warn` on selection, not faked.)
- `status`, `doctor`, `theme list`, `profile list`, `backup list` all rewritten to use the new
  table/panel components.

### A real bug found and fixed during this phase

Running the redesigned interactive home with piped/non-TTY stdin (simulating CI or a script)
**hung indefinitely** — `@clack/prompts`' `select()` has nothing to read from a non-TTY stdin
and waits forever. Confirmed by actually running it with a wrapper timeout before concluding
it was broken, not by inspection alone. Fixed: `runInteractiveHome()` now checks
`process.stdin.isTTY && process.stdout.isTTY` before entering any prompt and prints the status
panel + command suggestions instead when non-interactive. Added a regression test
(`tests/integration/cli.test.ts`, "exits promptly instead of hanging...") that runs the real
built binary with piped stdin under a 5-second timeout.

### Honest verification limits

- **The actual interactive arrow-key flow (select/intro/outro rendering, navigation feel,
  Escape/Ctrl+C behavior) has not been visually verified** — this tool only has non-TTY Bash
  access, and `@clack/prompts` requires a real TTY to render its interactive UI at all. What
  *was* verified: the non-interactive guard (confirmed via the timeout test above) and every
  one-shot command's actual table/panel output (`status`, `doctor`, `theme list`,
  `profile list`, `backup list` — all shown in this session's transcript, real output, not
  mockups).
- **Amar still needs to manually run `nightshift` in a real Windows Terminal window** and
  check: menu navigation feel, whether the connected left-bar clack style reads as intended,
  narrow-terminal behavior (resize the window), and whether the grouped Workspace/
  Customization/Integrations/System navigation is better or worse than a flat list in
  practice.

### Not yet done at the end of Phase 1 (explicitly, not silently dropped)

Kept as the record of what Phase 1 left open, each annotated with where it was resolved rather
than deleted:

- No accessibility/contrast validation beyond "uses the theme's own colors." — **resolved** in
  the hardening cycle (`8a2a660`): `core/themes/contrast.ts`, surfaced in `theme preview`,
  `theme validate` and `doctor`.
- No `--no-color` / `NO_COLOR` env var explicit test. — **resolved** in the hardening cycle
  (`8a2a660`): `src/cli/ui/color-mode.ts` plus `tests/integration/no-color.test.ts`, which
  asserts zero ANSI escape sequences from the built binary rather than trusting each library's
  own claim.
- Confirmation panels, dedicated error-panel styling, and empty-state styling beyond plain text
  are not yet built as separate reusable components. — **partially resolved**: `src/cli/ui/
  feedback.ts` now provides uniform `✓` / `!` / `✗` + "next step" lines (and `setup` has a real
  confirmation step), but these are still formatted lines, not bordered panels. Still open.

### Tests and quality gates (as measured at the end of Phase 1 — superseded below)

- `npm run typecheck` — pass
- `npm run lint` — pass
- `npm run build` — pass
- `npm test` — **73/73 pass** (72 pre-existing + 1 new non-TTY-hang regression test), run
  immediately before this status was written
- `npm pack --dry-run` — clean, 32.8kB tarball, 61 files, no secrets/dev artifacts
- `npm audit` — unchanged from before this phase (10 findings, all devDependency/Zod, see
  `docs/SECURITY-MODEL.md`). The `zod` 4 upgrade in the hardening cycle cleared these; the
  current count is 0, recorded below.

## Phase 2 — Automatic setup

Status: **Done**

`nightshift setup [--yes]`, in `src/cli/commands/setup.ts`, merged as part of `8a2a660`.

This is the phase "why phases are not all attempted at once" was written for, so the rule it
names is enforced structurally rather than by intent: `buildSetupProposal()` and
`renderSetupProposal()` perform no writes at all, so the non-interactive path is *incapable* of
modifying the machine, not merely choosing not to. The proposal names every path it would
touch — the config directory, the backup snapshot destination, and Windows Terminal's
`settings.json` — before anything happens.

Evidence:

- `tests/integration/setup.test.ts` — 6 cases, including "prints the proposal and writes
  NOTHING without a TTY and without `--yes`" (asserted against both the function and the real
  built `dist/index.js`, because "writes nothing" is a claim about a process, not a function).
- Verified by running the built binary against an isolated `APPDATA` with no TTY: it printed
  the full proposal, exited `0`, and the config root was still **empty** afterwards.
- The `--yes` executing path is exercised against a temporary `LOCALAPPDATA` containing a fake
  `settings.json`, never live — see "honest verification limits" below.

## Phase 3 — Font manager

Status: **Partially done — detection, plus a copy-only install (no registry write, no download)**

`src/core/fonts/detect.ts` plus `font list` / `font check`, merged as `9300015`.

- Reads the installed families out of `%LOCALAPPDATA%\Microsoft\Windows\Fonts` and
  `%WINDIR%\Fonts` by parsing each file's sfnt `name` table. Verified live: 200 families
  reported on this machine.
- `doctor` now reports whether the *active theme's* `typography.family` is installed. This is
  the load-bearing half: `theme apply` writes that family into Windows Terminal's
  `profiles.defaults.font.face`, Windows Terminal silently substitutes another font when it is
  missing, and NIGHTSHIFT printed `✓ Applied` either way. Verified live — this machine does
  *not* have `Cascadia Code`, which the default theme `ghost-protocol` requests, so `doctor`
  reports exactly that case rather than a hypothetical one.
`font install <path>` (issue #15) adds the write half: `src/core/fonts/install.ts` plus
`runFontInstall`.

- Copies a local `.ttf`/`.otf`/`.ttc` file, or every font file in a directory, into
  `%LOCALAPPDATA%\Microsoft\Windows\Fonts`. It is the same `buildProposal` / `renderProposal` /
  `execute` shape as `setup` — the first two write nothing, so the non-interactive path cannot
  write at all — with the same TTY guard and the same `--yes` semantics.
- Verification re-runs `findInstalledFont` after the copy. A family the detector still cannot
  find is reported as a failure with exit `1`, not as a success with a caveat.
- **Not done, and stated in the proposal before approval rather than discovered afterwards:**
  the registry value under `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts` that
  Windows uses to enumerate fonts. Writing it needs `reg.exe` (a child process) or a Win32 call
  (a native dependency), and `src/` has neither. So the command prints the exact `reg add`
  command the user must run to finish, and never claims the registration happened. **A user
  will hit this:** after `font install`, `nightshift font check` finds the family while
  Windows Terminal's own font picker may not.
- **Not done:** downloading fonts (it would be this project's first network operation and a
  threat-model change — the path argument is local-only), removing fonts, and writing
  `%WINDIR%\Fonts` for all users.
- **Known ceiling:** Nerd Font flagging is a name-based heuristic, not glyph inspection. The
  command's own output states this, and so does `README.md`.

## Phase 4 — Theme engine completion

Status: **Done for authoring and validation**

Merged as part of `8a2a660`.

- `theme validate <file>` reports **every** schema issue at once with its field path, not the
  first. Verified live: the previously-documented README theme example produced exactly 16
  errors, one per missing `ansi` key (see Phase 15 below — that was a real user-facing trap and
  the example has been completed).
- `theme create` clones an existing theme, so the file is valid and applyable the moment it is
  written. `theme remove` refuses built-ins and refuses the active theme. Both verified live
  against an isolated `APPDATA`.
- WCAG 2.x contrast (`src/core/themes/contrast.ts`) surfaced in `theme preview`,
  `theme validate` and `doctor`. All four built-in themes pass AA 4.5:1 on all 24 checked
  pairs; the narrowest margin is `redline`'s primary at **4.98:1**, confirmed by auditing every
  theme through the built module.
- Contrast is **advisory everywhere**. Verified by validating a deliberately dim theme: it
  reported two colors below 4.5:1 and still exited `0`. A dim theme is a valid theme.
- **Theme editing is done** (#40): `theme edit <id> --set <role>=<#RRGGBB>`, repeatable, plus an
  **Edit a theme** action in the interactive Theme Studio menu. The new contrast ratios are
  printed *before* the write, so a change that makes text unreadable is visible at the moment it
  is made rather than after it is applied. It reuses `createTheme`'s write path and
  `validateThemeFile`'s schema, so there is still exactly one theme writer and one source of
  validation messages. This closed the gap that issue #20 (a visual editor) was really reaching
  for — see that issue for why a localhost GUI was rejected instead.
- **Not done:** no palette generation, no import of third-party scheme formats (base16, iTerm,
  Windows Terminal `schemes` entries).

## Phase 13 — Security and reliability (partial)

Status: **Partially done**

Delivered in this cycle, all verified by execution:

- A three-value exit-code contract (`0` / `1` / `2`), documented in `docs/ARCHITECTURE.md` and
  now in `README.md`. Verified live: a root-array `config.json` makes `status`, `theme list`
  and `doctor` exit `2` while still printing their full report; an invalid theme file, an
  unknown id, an uninstalled font and every Commander usage error exit `1`.
- `doctor` no longer reports a corrupt `config.json` as `✓ initialized` — it was only an
  `existsSync` check before, so the one command a user runs when things are broken was hiding
  the breakage.
- A legacy array-form `profiles` key in Windows Terminal's `settings.json` is **refused**
  instead of being converted to an object, which previously destroyed the user's profile list
  while reporting success (`tests/integration/wt-legacy-profiles.test.ts` asserts the file is
  left byte-identical).
- A `settings.json` containing `//` comments used to fail with the file name and the real cause
  instead of `Unexpected token /`, but still could not be applied to. As of 0.4.0 it is read as
  JSONC and written with targeted text edits, so it applies and the comments survive (#14).
- `backup list` no longer fails on malformed metadata; one broken entry is skipped rather than
  hiding every good backup. Verified live by planting an invalid `metadata.json` — the listing
  still showed both valid backups.

**Not done:** no code signing, no marketplace integrity verification (there is no marketplace),
no audit log of applied changes.

## Phase 14 — Testing and CI (partial)

Status: **In progress on a parallel branch.** Test-suite work is owned by a separate change on
this cycle; the numbers below are what the suite reported here and will move as that lands.

- `npm test` — **332/332 pass across 26 files**, run on this branch immediately before this was
  written.
- `npm audit` — **0 vulnerabilities**. The 10 findings recorded under Phase 1 were cleared by
  the `zod` 4 upgrade.
- `npm run typecheck`, `npm run lint`, `npm run build` — pass.
- CI runs Node 22.12.0, 24 and 26, matching `package.json`'s `engines` floor of `>=22.12.0`.

## Phase 15 — Documentation (in progress)

Status: **In progress on this branch**

The command reference in `README.md` omitted four shipped commands (`setup`,
`theme validate|create|remove`) and both `font` commands, and there was no exit-codes section at
all for a CLI whose exit codes are a contract scripts depend on (issue #8). Fixed, with every
row in that table verified by running the command against an isolated config root.

One documented example was an active trap rather than merely stale: the theme example used
`"ansi": { "...": "16 ANSI colors, see src/core/themes/schema.ts" }` as shorthand, which was
harmless before `theme validate` existed and became a 16-error paste the moment it shipped. The
example is now the complete file, verified by extracting the JSON block straight out of
`README.md` and running `theme validate` on it (exit `0`).

## Phases 5–12, 16

Status: **Not started.** See "why phases are not all attempted at once" above. In roadmap order:
Phase 5 ASCII Art Studio, Phase 6 shell integrations, Phase 7 widget engine, Phase 8 Claude Code
integration (detection only today, no settings read or written), Phase 9 cross-platform
adapters, Phase 10 Studio, Phase 11 marketplace, Phase 12 additional customization, Phase 16
release prep (blocked on the version decision in issue #9).

## Honest verification limits (current)

What still needs a human, or a machine this tool does not have:

- **`theme apply`, `profile apply` and `setup --yes` were not run live for this documentation
  pass.** They write Windows Terminal's real `settings.json` regardless of `APPDATA`, because
  capability detection reads the real `%LOCALAPPDATA%`. They are verified instead through the
  temporary-`LOCALAPPDATA` harness in `tests/integration/theme-apply-engine.test.ts`,
  `profile-apply.test.ts` and `setup.test.ts`, and by reading the code. Every other command in
  the `README.md` reference table was executed against an isolated config root.
- **The interactive arrow-key flow is still not visually verified.** `@clack/prompts` needs a
  real TTY to render at all, and this tool has none. What *is* verified is the non-interactive
  guard (a timeout test against the built binary) and every one-shot command's real output.
  `setup`'s confirmation prompt inherits the same limit: the non-interactive refusal is tested,
  the prompt itself is not.
- **Contrast ratios are computed, not observed.** The WCAG numbers are arithmetic on the
  theme's own hex values. They say nothing about how the colors look through Windows Terminal's
  transparency, acrylic, or font smoothing.
- **Nerd Font detection is a name heuristic.** Glyph coverage is never inspected, so a patched
  font under an unpatched name reads as "no" and a font merely named like one reads as "likely".
- **`font install` was never run against the real font directory.** Like `theme apply`, it is
  exercised only through a temporary `LOCALAPPDATA` (`tests/integration/font-install.test.ts`),
  because a test that got the environment wrong would install fixture fonts onto the
  developer's machine. What that harness proves is that the copy lands, that the proposal path
  writes nothing, and that detection confirms the family afterwards. What it cannot prove is
  the part NIGHTSHIFT does not do: **whether Windows Terminal picks up a font that was copied
  but not registered is unverified**, and the command's own output assumes the pessimistic
  answer rather than claiming the optimistic one.
- **Font detection was verified on one machine only.** 200 families, two directories, one
  Windows 11 install. A machine with fonts registered only in the registry, or a non-Windows
  machine, is covered by `unsupported`/`unknown` reporting rather than by having been tried.
- **Amar still needs to run `nightshift` and `nightshift setup` in a real Windows Terminal
  window** and check: menu navigation feel, the confirmation prompt, narrow-terminal behavior
  (resize the window), and whether `theme apply` with a missing font now reads clearly enough
  now that `doctor` names it.
