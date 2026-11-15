# NIGHTSHIFT CLI UX audit

Owner: `devex-ux-agent`
Branch: `feat/nightshift-1.0.0`
Date: 2026-11-15
Method: **every command below was executed**, against the built binary (`node dist/index.js`).
Output and exit codes are pasted as produced, not reconstructed.

Config root was isolated for every run so nothing touched the developer's real state:

```bash
export NSTMP=$(mktemp -d); APPDATA="$NSTMP" node dist/index.js <args>; echo "exit=$?"
```

## Scope limits, stated up front

| Limit | Consequence |
|---|---|
| **No TTY.** This environment has no pseudo-terminal. | `@clack/prompts` cannot render. The entire interactive flow is unverifiable here. See [§7](#7-must-be-checked-by-a-human-in-a-real-tty). |
| **`theme apply` / `profile apply` were not run.** | They write the developer's **real** Windows Terminal `settings.json` regardless of `APPDATA`. Their output format was read from source and is flagged for runtime verification in §7. |
| **`COLUMNS` was not honoured by the code at audit time.** | Narrow-terminal behaviour could not be exercised by env var. It was assessed by calling `renderTable` directly against `dist/`. Which method produced each number is stated in [§4](#4-narrow-terminal-behaviour). |

---

## 1. Findings ranked by impact

### F1 — HIGH — An unknown command produces a message that names the wrong problem

```
$ nightshift bogus-command
error: too many arguments. Expected 0 arguments but got 1.
exit=1
```

The user typed a command name; they are told about argument *arity*. Nothing names the
offending word, suggests a correction, or points at `--help`. Cause: `src/index.ts` registers a
default `program.action()` for the interactive home, so Commander classifies an unknown
command as an excess positional argument instead of an unknown command.

**Not fixed in this wave** — `src/index.ts` is owned by another work stream this cycle. Fix is
`program.showSuggestionAfterError()` plus an explicit unknown-command path that coexists with
the default action.

### F2 — HIGH — Every table overflowed the terminal by exactly 2 columns, at every width

Measured by calling `renderTable` directly with `process.stdout.columns` forced:

| `columns` | table width | overflow |
|---|---|---|
| 20 | 102 | +82 |
| 21 | 57 | +36 |
| 40 | 57 | +17 |
| 60 | 62 | +2 |
| 80 | 82 | +2 |
| 120 | 122 | +2 |

Two distinct defects:

1. **Constant +2 at all widths.** `table.ts` subtracted a flat `2` for borders, but a table
   draws one border glyph per column plus a closing one — 4 for the 3-column tables this CLI
   renders. In a real 120-column terminal every table wrapped.
2. **A hard ~57-column floor.** The widest column was floored at `MAX_REGULAR_COLUMN_WIDTH`
   (32), and regular columns never shrank below their natural content width, so a 3-column
   table could not render narrower than ~57 columns regardless of terminal size.
3. **`columns = 20` fell back to 100.** The guard was `> 20`, excluding 20 itself, so the
   narrowest terminal received the *widest* table.

**Fixed** in `src/cli/ui/table.ts` (border count by column count; proportional squeeze when
space is tight; `>= 20` guard). Regression test: `tests/unit/table-width.test.ts`.

### F3 — MEDIUM — `NO_COLOR` was not actually honoured where it mattered

See [§3](#3-no_color--no-color) for the full mechanical proof. Summary: `chalk`'s own
precedence lets `FORCE_COLOR` override `NO_COLOR`, and `boxen` resolves border color against
`chalk.level` **at its own import time**, so lowering the level afterwards never reached it —
`status` leaked 4 colored border lines under `NO_COLOR=1`. **Fixed.**

### F4 — MEDIUM — `theme preview` conveyed nothing without color

```
$ nightshift theme preview ghost-protocol
Ghost Protocol
Cybersecurity-inspired green on dark graphite.

 bg   fg   primary   secondary   success   warning   error
exit=0
```

The swatches are `chalk.bgHex` background blocks. With color off — a pipe, a dumb terminal,
`NO_COLOR` — they render as blank space, so the only command whose entire purpose is showing
colors degraded to a row of labels. A theme-preview command should not be the one surface that
fails when color is unavailable.

**Fixed:** each swatch now carries its own hex in the label, and a WCAG contrast table is
printed alongside, so the command is informative with color fully disabled. Covered by
`tests/integration/no-color.test.ts` ("colorless output still carries the information").

### F5 — MEDIUM — No contrast validation existed (G13)

No surface reported whether a theme's colors were readable. Added — see [§5](#5-wcag-contrast).

### F6 — MEDIUM — Error messages were shape-inconsistent and half of them had no next step

All of these were plain `chalk.red` one-liners with no shared structure:

| Command | Output | exit | Next step? |
|---|---|---|---|
| `theme preview nope` | `No theme found with id "nope". Run \`nightshift theme list\`.` | 1 | yes, inline |
| `profile show nope` | `No profile found with id "nope". Run \`nightshift profile list\`.` | 1 | yes, inline |
| `profile export nope` | `No profile found with id "nope".` | 1 | **no** |
| `restore bogus-id` | `No backup found with id "bogus-id"` | 1 | **no** (and no trailing period) |
| `profile remove ghost-protocol-default` | `"ghost-protocol-default" is a built-in profile and cannot be removed.` | 1 | **no** |
| `profile import /nonexistent` | `No file found at "C:/Program Files/Git/nonexistent".` | 1 | **no** |

Exit codes are at least consistent (all `1`). The messages are not: some embed a next step in
the sentence, some offer none, one lacks terminal punctuation.

**Partly fixed:** `src/cli/ui/feedback.ts` provides the shared shape (glyph, message, indented
`→ hint`), adopted in `theme.ts` and `doctor.ts`. `profile.ts`, `backup.ts` and `init.ts`
belong to other work streams this cycle and are listed for adoption in §6.

> Note on `profile import /nonexistent`: the path became `C:/Program Files/Git/nonexistent`
> because Git Bash rewrites leading-slash arguments (MSYS path translation). That is a quirk of
> the audit shell, **not** a CLI defect.

### F7 — LOW — Mixed path separators in `status` and `doctor`

```
│ Claude Code      │ partially detected (C:\Users\Amar/.claude/settings.json)   │
```

`C:\Users\Amar` + `/.claude/settings.json`. Functional on Windows, but it looks like a bug in
a tool whose output is its product. Cause is string concatenation rather than `path.join` in
capability detection (`src/core/capabilities/detect.ts` — domain logic, another owner).

### F8 — LOW — `--help` has no examples and does not mention color control

Root `--help` lists commands and `-V/-h` only. For a customization tool, one example line
(`nightshift theme apply ghost-protocol`) would carry more than the description does.
Separately, `--no-color` now works but **does not appear in `--help`**, because registering it
requires `src/index.ts` (see §3).

### F9 — INFO — `theme list` and `profile list` have no reachable empty state

Both always contain built-ins (4 themes, 2 profiles), so the empty branch cannot trigger while
the package ships its defaults. `backup list` is the only genuinely reachable empty state:

```
$ nightshift backup list
No backups found.
exit=0
```

Correct and exit-0, but a plain unstyled line with no next step (`nightshift backup create`).
A defensive empty state was added to `theme list`; `backup list` belongs to another owner (§6).

---

## 2. Help text — completeness and consistency

Every one of these was run; all exited `0`.

| Command | Result |
|---|---|
| `--help` | 7 commands listed, each with a description. No examples. |
| `theme --help` | `list`, `preview <id>`, `apply <id>` — consistent. |
| `theme apply --help` | Usage + `-h`. No mention that it writes `settings.json` or creates a backup first. |
| `profile --help` | 6 subcommands; `import`/`export` correctly show `[options]`. |
| `profile import --help` | `--overwrite` documented. |
| `backup --help` | `create`, `list`. No `backup restore` — `restore` is a **root** command. |

Two consistency observations:

- **`restore` is a root command while `backup create|list` are nested.** `nightshift backup
  list` tells you an id; restoring it requires `nightshift restore <id>`, not `nightshift
  backup restore <id>`. Discoverable only by reading root `--help`.
- **No command documents its write surface.** `theme apply` and `profile apply` modify Windows
  Terminal's `settings.json`; neither `--help` says so. For a tool that edits a file the user
  did not name, that belongs in the help text.

## 3. `NO_COLOR` / `--no-color`

### Why the obvious test proves nothing

Piped, non-TTY output is **already** ANSI-free because chalk auto-disables itself. Baseline,
counting lines containing ESC via `grep -c $'\033'`:

```
status                           plain=0    NO_COLOR=1 -> 0
doctor                           plain=0    NO_COLOR=1 -> 0
theme list                       plain=0    NO_COLOR=1 -> 0
theme preview ghost-protocol     plain=0    NO_COLOR=1 -> 0
profile list                     plain=0    NO_COLOR=1 -> 0
```

Zero everywhere — and **worthless as evidence**. It does not distinguish "`NO_COLOR` was
honoured" from "stdout was a pipe". To test the real thing, color must first be forced on with
`FORCE_COLOR=3`, which reproduces the path a real TTY takes.

### What that revealed (before the fix)

```
cmd                              FORCE_COLOR=3   +NO_COLOR=1
status                           10              10
doctor                           9               9
theme list                       9               9
theme preview ghost-protocol     3               3
profile list                     7               7
```

**`NO_COLOR` had no effect at all.** chalk/supports-color deliberately lets `FORCE_COLOR`
override `NO_COLOR`. A real TTY with `NO_COLOR=1` and no `FORCE_COLOR` *would* have been
colorless — but that cannot be demonstrated without a TTY, and relying on it leaves the
property untestable in CI forever.

Two root causes were isolated:

1. **chalk precedence.** `FORCE_COLOR` beats `NO_COLOR` by design.
2. **boxen snapshots `chalk.level` at import time.** Proven directly: setting `chalk.level = 0`
   *before* importing boxen gave 0 ANSI chars; setting it *after* gave 8, for both hex and
   named `borderColor`, with no nested chalk copy in `node_modules`. This is why `status`
   specifically kept leaking 4 colored border lines even once chalk was muted.

### Fix

- `src/cli/ui/color-mode.ts` sets `chalk.level = 0` for any non-empty `NO_COLOR` (per
  no-color.org) or a `--no-color` argv entry. Deliberately **overrides** `FORCE_COLOR`: an
  explicit user opt-out should win, and it makes the property mechanically provable.
- `src/cli/ui/panel.ts` omits `borderColor` entirely when `chalk.level === 0`, rather than
  depending on module evaluation order.

### Proof after the fix

`FORCE_COLOR=3` on every run, counting ESC-bearing lines:

```
cmd                              FORCE_COLOR=3   +NO_COLOR=1   +--no-color (exit)
status                           10              0             0 (exit=0)
doctor                           10              0             0 (exit=0)
theme list                       9               0             0 (exit=0)
theme preview ghost-protocol     11              0             0 (exit=0)
profile list                     7               0             0 (exit=0)
backup list                      1               0             0 (exit=0)
```

**What this proves:** with color forced to the level a real TTY would use, both `NO_COLOR=1`
and `--no-color` produce byte-for-byte zero ANSI across all six commands, and `--no-color`
exits `0` rather than being rejected.

**What it does not prove:** that a *real* Windows Terminal session renders identically. The
mechanism (chalk level 0) is terminal-independent, but TTY-only code paths in clack are
untested — see §7.

Locked in by `tests/integration/no-color.test.ts` (21 cases), which includes positive-control
tests asserting ANSI **is** present under `FORCE_COLOR=3`, so the suite cannot silently degrade
into passing trivially.

### The `--no-color` trade-off (must be followed up)

`--no-color` is **not** registered as a Commander option, because `src/index.ts` belongs to
another work stream this cycle. Commander rejects unregistered options before any action runs:

```
$ FORCE_COLOR=3 node dist/index.js status --no-color
error: unknown option '--no-color'
exit=1
```

So merely reading `process.argv` would have shipped a flag that was documented but broken.
Instead `color-mode.ts` **splices `--no-color` out of `process.argv`** so Commander never sees
it. This is safe only because every command module is imported at `src/index.ts`'s module
scope, so the side effect completes before `program.parseAsync()` is reached.

It is still a global mutation in the wrong place, and it has a visible cost: **the flag does not
appear in `--help`.**

**Required follow-up:** register `.option("--no-color", "disable colored output")` on the root
`program` in `src/index.ts`, then delete the splice from `color-mode.ts`.

## 4. Narrow-terminal behaviour

**Honest statement of method.** `COLUMNS=20` and `COLUMNS=40` were both run against the real
binary and **produced no change whatsoever** — identical 100-column tables:

```bash
$ COLUMNS=20 APPDATA="$NSTMP" node dist/index.js theme list   # -> unchanged, 102 cols
$ COLUMNS=40 APPDATA="$NSTMP" node dist/index.js theme list   # -> unchanged, 102 cols
```

Cause, confirmed directly:

```bash
$ COLUMNS=40 node -e 'console.log(process.stdout.columns, process.stdout.isTTY, process.env.COLUMNS)'
undefined undefined 40
```

`table.ts` read only `process.stdout.columns`, which is `undefined` for non-TTY stdout, so it
fell through to the hardcoded 100. **The narrow path was unreachable by env var**, exactly as
suspected. All numbers in F2 therefore come from **calling `renderTable` directly** from
`dist/cli/ui/table.js` with `process.stdout.columns` redefined — not from env vars, and not
from source reading.

Two changes make this honest going forward:

- `terminalWidth()` now falls back to `process.env.COLUMNS` when stdout is not a TTY, so
  `COLUMNS=40 nightshift theme list` genuinely narrows.
- `tests/unit/table-width.test.ts` asserts the table never exceeds the terminal width across
  `columns` of 24/40/60/80/100/120/200, plus the `COLUMNS` fallback and the 100-column default.

One claim was **investigated and retracted**: an early probe appeared to show the table eating
Windows path separators (`C:UsersAmar...`). That was backslash mangling in the probe script's
own heredoc, not a rendering bug. Verified: with separators built via `String.fromCharCode(92)`
all 8 survive rendering. A regression test now pins it.

Residual limitation: `cli-table3` truncates with `…` rather than wrapping mid-token, so a long
Windows path in a 40-column terminal is unavoidably clipped. Wrapping a path at arbitrary
characters would not be more readable.

## 5. WCAG contrast

`src/core/themes/contrast.ts` — pure, dependency-free, WCAG 2.x relative luminance and contrast
ratio. Math verified against reference values in `tests/unit/contrast.test.ts` before any theme
number was trusted: `#000` on `#FFF` = 21:1, identical colors = 1:1, sRGB primary luminances
(0.2126 / 0.7152 / 0.0722), `#767676` on white = 4.54:1, and order-independence.

### Measured ratios — all four built-in themes, against each theme's own background

| theme | bg | foreground | primary | secondary | success | warning | error |
|---|---|---|---|---|---|---|---|
| `ghost-protocol` | `#0A0D0B` | 15.28 | 12.21 | 6.12 | 12.21 | 10.34 | 6.24 |
| `monolith` | `#121212` | 14.64 | 8.14 | 5.43 | 8.92 | 8.14 | 5.53 |
| `redline` | `#0D0A0A` | 14.68 | **4.98** | 5.69 | 8.66 | 10.44 | 5.81 |
| `deep-space` | `#080B14` | 14.99 | 11.46 | 5.62 | 8.88 | 11.68 | 5.78 |

**All 24 pairs meet WCAG AA 4.5:1 for body text. No built-in theme fails.** No threshold was
adjusted and no shipped theme color was changed.

Narrowest margin: `redline.primary` (`#E64545`) at **4.98:1** — passing, but the only pair
within 0.5 of the AA floor. Worth knowing before anyone darkens that red.

For reference, AA large-text (>= 18pt, or >= 14pt bold) requires only 3:1; every pair above
clears that too.

### Where it surfaces

`theme preview <id>` prints a per-pair table, and `doctor` checks the **active** theme.

The failing path is **not dead code** — verified with a deliberately low-contrast *user* theme
(no built-in was modified):

```
$ nightshift theme preview dim-test
│ ✓ │ foreground │ #DCE6DF │ 15.28:1 │ pass (body text)      │
│ ✗ │ primary    │ #2A4A33 │ 1.98:1  │ fail (needs >=4.5:1)  │
│ ✗ │ secondary  │ #1F3326 │ 1.45:1  │ fail (needs >=4.5:1)  │
│ ✓ │ success    │ #65E58B │ 12.21:1 │ pass (body text)      │
│ ✓ │ warning    │ #E8B45C │ 10.34:1 │ pass (body text)      │
│ ✗ │ error      │ #4A2A2A │ 1.54:1  │ fail (needs >=4.5:1)  │
! 3 colors below WCAG AA 4.5:1 for body text: primary, secondary, error.
  → primary, secondary, error fall below even the 3:1 large-text minimum.
```

and the large-text-only variant:

```
$ nightshift theme preview mid-test
! 1 color below WCAG AA 4.5:1 for body text: primary.
  → Usable for large or bold text (>=3:1), but not for body text.
```

`doctor`, active theme `redline`:

```
│ ✓ │ Theme contrast    │ all 6 pairs meet WCAG AA 4.5:1 - redline: foreground 14.68:1, primary    │
│   │                   │ 4.98:1, secondary 5.69:1, success 8.66:1, warning 10.44:1, error 5.81:1  │
```

A contrast failure is reported as a **warning, never a failure**, so it does not change
`doctor`'s exit code: a low-contrast palette is a readability issue with the user's chosen
theme, not a broken environment.

The check degrades rather than crashing on unreadable config — observed live during the audit
with a hand-corrupted `config.json`:

```
│ ! │ Theme contrast    │ could not read config: NIGHTSHIFT's configuration file could not be read │
```

### Caveat on what a contrast ratio means here

These ratios are computed between a theme's **declared** color roles and its **declared**
background. They do not account for terminal transparency/acrylic, the user overriding colors
in Windows Terminal, font weight and size, or subpixel rendering. A passing ratio is a
necessary condition for readability, not a sufficient one.

## 6. Components added, and where they are adopted

`src/cli/ui/feedback.ts` — `errorMessage`, `emptyState`, `successMessage`, `warnMessage`,
`failWith`. Shared shape: a status glyph, the message, and an optional indented `→ hint`.

Deliberately **plain lines, not boxen panels**, per the recorded two-border-language rule:
boxen is reserved for one-shot command *headers* (`panel.ts`), clack's `note`/`box` for the
interactive flow. A failure is not a header, and boxing a one-line error buries it in six lines
of chrome. What was missing was a consistent shape, not more decoration.

Every state is marked with a glyph (`✓ ! ✗`) in addition to color, so meaning survives
`NO_COLOR` and color-blindness — asserted in `tests/unit/feedback.test.ts` and in the
colorless integration case.

Adopted in: `src/cli/commands/theme.ts`, `src/cli/commands/doctor.ts`.

**Pending adoption by their owners** (not touched this wave to avoid clobbering parallel work):

| File | States to convert |
|---|---|
| `src/cli/commands/profile.ts` | `profile show/export/remove` failures (F6) |
| `src/cli/commands/backup.ts` | `backup list` empty state (F9); `restore` failure (F6) |
| `src/cli/commands/init.ts` | already-initialized notice; only command that imports no UI module, so `NO_COLOR` does not currently reach it |

## 7. Must be checked by a human in a real TTY

**None of the following was verified. This environment has no TTY, so `@clack/prompts` cannot
render at all.** No claim is made about any of it.

Interactive flow (`src/cli/interactive/home.ts`, `src/cli/ui/prompts.ts`):

1. `nightshift` with no arguments — whether the clack `intro`/`select`/`outro` left-bar style
   renders as intended.
2. Arrow-key navigation through Workspace / Customization / Integrations / System, and whether
   the grouping beats a flat list in practice.
3. **Escape and Ctrl+C.** clack reports both as one cancellation signal; the code treats both as
   "back one level" in a submenu and "exit" at the top level. Confirm neither orphans the
   terminal with a hidden cursor or a broken echo state.
4. Selecting a `planned` item — should warn, not fake.
5. Whether boxen panels and clack boxes ever appear on the same screen (the two-border-language
   rule says they must not).

Color and contrast in a real terminal:

6. `NO_COLOR=1 nightshift status` in Windows Terminal. Mechanically proven ANSI-free here under
   `FORCE_COLOR=3`; confirm the real session matches.
7. `nightshift theme preview <id>` with acrylic/transparency enabled — the measured ratios
   assume an opaque background and will be optimistic if transparency is on.
8. Whether `redline`'s 4.98:1 primary is comfortable in practice at 14pt, given it is the
   closest pair to the AA floor.

Terminal geometry:

9. **Resize the window narrow** (~40 columns) and re-run `status`, `doctor`, `theme list`. In a
   real TTY `process.stdout.columns` is defined, so this exercises a path reachable here only
   by direct function call.
10. Confirm no table wraps at the default width — F2's constant +2 overflow was invisible in
    piped output and only ever showed up in a real terminal.

Write-surface commands, **never executed in this audit** (they modify the real
`settings.json`):

11. `nightshift theme apply <id>` — success and failure output, backup id reporting, rollback
    message. Format read from source only.
12. `nightshift profile apply <id>` — same.
13. `nightshift restore <id>` — round-trip after a real apply.
14. Behaviour when Windows Terminal is **running** during an apply (file lock / live reload).

---

## 8. Quality gate

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass |
| Lint | `npm run lint` | pass, 0 errors 0 warnings |
| Build | `npm run build` | pass |
| Tests | `npm test` | **189 passed, 18 files** |

54 of those tests were added by this wave; none were modified, skipped, or removed.

| New test file | Cases | Covers |
|---|---|---|
| `tests/unit/contrast.test.ts` | 14 | WCAG math against reference values; all built-in themes |
| `tests/integration/no-color.test.ts` | 21 | ANSI-free output from the real binary, with positive controls |
| `tests/unit/table-width.test.ts` | 9 | F2 width regressions, `COLUMNS` fallback, separator preservation |
| `tests/unit/feedback.test.ts` | 10 | Component shape, glyph-not-color-alone, `NO_COLOR` precedence |

No dependency was added.
