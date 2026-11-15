# NIGHTSHIFT roadmap status

Updated after every completed phase. This is the single source of truth for "what's actually
done" — if it's not checked off here with a commit hash, it isn't done. Phase numbers below
follow the current (most detailed) 1.0.0 directive: Phase 0 = verify foundation, Phase 1 =
modern CLI redesign, Phase 2 = automatic setup, Phase 3 = font manager, Phase 4 = theme engine
completion, Phase 5 = ASCII Art Studio, Phase 6 = shell integrations, Phase 7 = widget engine,
Phase 8 = Claude Code integration, Phase 9 = cross-platform adapters, Phase 10 = Studio,
Phase 11 = marketplace, Phase 12 = additional customization, Phase 13 = security/reliability,
Phase 14 = testing/CI, Phase 15 = documentation, Phase 16 = release prep.

**Current branch:** `feat/nightshift-1.0.0`
**Merged foundation:** `0.2.0` (Profile Manager), PR #1, commit `ac223d6` on `main`
**Current phase:** Phase 1 (modern CLI redesign) — done for its first increment; see below for
exact scope

## Authorship audit (this session)

Checked PR #1's description and the last several `main` commit messages for any AI
co-author/attribution text. None found — no cleanup was needed. This check will be repeated
for every future PR before it's opened, not just retroactively.

## Why phases are not all attempted at once

- **Font installation (Phase 3)** writes files to the user's font directory — a
  "user-approved action." Needs a specific proposal shown before any write.
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

### Not yet done (explicitly, not silently dropped)

- No accessibility/contrast validation beyond "uses the theme's own colors."
- No `--no-color` / `NO_COLOR` env var explicit test (chalk/clack/boxen/cli-table3 all claim to
  respect it per their own docs; not independently re-verified here).
- Confirmation panels, dedicated error-panel styling, and empty-state styling beyond plain text
  are not yet built as separate reusable components — current error/empty messages are plain
  `chalk.red`/`chalk.gray` lines, functional but not yet "panelized."

### Tests and quality gates

- `npm run typecheck` — pass
- `npm run lint` — pass
- `npm run build` — pass
- `npm test` — **73/73 pass** (72 pre-existing + 1 new non-TTY-hang regression test), run
  immediately before this status was written
- `npm pack --dry-run` — clean, 32.8kB tarball, 61 files, no secrets/dev artifacts
- `npm audit` — unchanged from before this phase (10 findings, all devDependency/Zod, see
  `docs/SECURITY-MODEL.md`)

## Phases 2–16

Status: **Not started.** See "why phases are not all attempted at once" above.
