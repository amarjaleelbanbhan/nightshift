# NIGHTSHIFT

**Your terminal. Your identity.**

NIGHTSHIFT is an open-source developer terminal customization toolkit. It's a CLI-first
configuration layer for the tools you already use — Windows Terminal today, more terminals
and shells later — not a terminal emulator or a replacement for them.

This is an early (`0.4.0`) development release. It implements a real, working foundation: theme
management (authoring, validation and editing) and profile management, both with safe
apply/rollback to Windows Terminal; guided first-run setup; font detection plus a copy-only
`font install`; PowerShell-profile shell integration; a read-only Claude Code appearance check;
and backup/restore.

It does not implement the full long-term vision — font *downloading*, Starship *configuration*,
and Linux/macOS adapters are not built, and the marketplace, widget engine, visual Studio and
ASCII Art Studio have been **decided against** rather than merely postponed. All of that is
tracked honestly below, not advertised as done. See `ROADMAP_STATUS.md` for the phase-by-phase
status of the full 1.0.0 roadmap.

## Status: Implemented / Partial / Planned

**Implemented**

- Theme engine: 4 built-in themes, Zod-validated schema, list/preview.
- `theme apply`: writes a theme into Windows Terminal's `settings.json`, preserving every
  unrelated key, with an automatic backup-and-rollback on failure. `--dry-run` shows the exact
  keys it would add or replace, in the file it would really write, and writes nothing.
- **Your `settings.json` comes back as your file.** `settings.json` is JSONC — the file
  Windows Terminal generates opens with a `//` header, and plenty of people annotate theirs.
  NIGHTSHIFT edits only the keys it changes, so comments, key order, indentation width, CRLF
  and a UTF-8 BOM all survive the write, and re-applying the same theme leaves the file
  byte-identical. Most theme switchers regenerate the file and quietly drop all of that.
- Theme authoring: `theme validate` (reports *every* schema problem at once with its field
  path), `theme create` (clones an existing theme into your user themes directory),
  `theme edit` and `theme remove`. A built-in theme id can never be overwritten, edited in
  place or removed, with or without `--overwrite`.
- `theme edit <id> --set <role>=<#RRGGBB>`: change a colour without opening the JSON, with the
  new WCAG contrast ratios shown *before* the write — so a change that makes text unreadable is
  visible at the moment it is made, rather than after you have applied it. `--set` is
  repeatable, every value goes through the same schema that backs `theme validate` (an invalid
  hex is refused with the same field path), and `--dry-run` prints the before/after and the new
  ratios without writing. Also available as **Edit a theme** in the interactive Theme Studio
  menu, which lists every role with its current value so nothing has to be spelled from memory.
- `setup`: guided first run. It prints the exact proposal — every path it would create, the
  backup it would take, the theme it would apply — and writes nothing until you approve it. In
  a non-interactive environment (CI, a pipe, redirected output) it prints the proposal and
  **writes nothing at all**; `--yes` is the only way to approve without a prompt.
- WCAG contrast reporting in `theme preview`, `theme validate` and `doctor`: each theme color's
  ratio against its own background, against the AA 4.5:1 body-text threshold. All four built-in
  themes pass on all 24 checked pairs (narrowest: `redline`'s primary at 4.98:1). Contrast is
  **advisory** — a dim theme is still a valid theme, so it never fails validation.
- Read-only font detection: `font list` and `font check`, plus a `doctor` check for whether the
  *active theme's* requested font is actually installed. That check exists because Windows
  Terminal silently substitutes a different font when the requested family is missing, and
  `theme apply` used to print success without mentioning it.
- `font install <path> [--yes]`: copies a local `.ttf`/`.otf`/`.ttc` file, or every font file in
  a directory, into your per-user font directory. It uses the same proposal-then-approve
  structure as `setup` — it prints every file it would write and writes nothing until you
  approve; without a TTY it prints the proposal and writes nothing, and `--yes` is the only way
  to approve without a prompt. It then re-runs detection to confirm the family is really there.
  **It does not create the registry value Windows uses to enumerate fonts**, and says so both
  in the proposal and after the copy, with the exact `reg add` command to finish the job. It
  never downloads anything (see "Known limitations").
- Shell integration: `shell status`, `shell init` and `shell remove` manage one clearly
  delimited block in your PowerShell profile (`$PROFILE`), between `# >>> nightshift >>>` and
  `# <<< nightshift <<<`. Because this edits a file your shell *executes* on every start — the
  highest blast radius in this tool — `shell init` prints **the exact diff, line by line**,
  backs the file up first, and writes nothing until you approve it; non-interactively it prints
  the diff and writes nothing, and `--yes` is the only way to approve without a prompt.
  Re-running replaces the block's contents rather than appending a second one (the file comes
  out byte-identical), and `shell remove` deletes exactly that block, leaving the rest of your
  profile — including your own comments — byte for byte as it was. A symlinked `$PROFILE` is
  followed, not replaced. **It does not write a `starship.toml`** (see "Partially implemented").
- PowerShell Tab completion (`completion powershell`), completing commands, options and -
  the part that matters - theme, profile and backup ids read from the live registries.
- A documented exit-code contract (see "Exit codes" below) and `--no-color` / `NO_COLOR`
  support, verified to emit zero ANSI escape sequences.
- Profile Manager: `profile list/show/apply/import/export/remove`, reusing the theme engine's
  backup/verify/rollback for `apply`. Profiles represent a supported theme selection today —
  not the full future developer environment (no font/widget/shell fields yet; see "Known
  limitations").
- Backup and restore for Windows Terminal's `settings.json`.
- Environment/capability detection (`doctor`, `status`) — reports what was actually detected,
  not what's assumed, and now also reports active profile and user-profile-directory health.
- Interactive home menu (`nightshift` with no args), grouped into Workspace / Customization /
  Integrations / System, with unimplemented sections clearly labeled instead of faked — Setup,
  Fonts and Shell Manager are now real entries there; Terminal Manager and Claude Code are
  still marked `planned`. ASCII Art Studio and Widgets were removed rather than relabelled,
  because both are closed as not planned (#22, #17) and a `planned` label for something nobody
  intends to build is a promise. Built on `@clack/prompts`; falls back to
  printing status and exiting if run without a real terminal (CI, pipes) instead of hanging.
- One-shot commands (`status`, `doctor`, `theme list`, `profile list`, `font list`,
  `backup list`) render through a shared, terminal-width-aware table/panel design system
  (`cli-table3` + `boxen`) instead of hand-built padded strings.

**Partially implemented**

- Claude Code integration: **read-only, and permanently so by decision** (#18). `doctor` reports
  whether `~/.claude/settings.json` exists, and compares Claude Code's own light/dark `theme`
  setting against the active theme's background luminance — because when those disagree, Claude
  Code renders light-theme syntax colours on a dark terminal and nothing else tells you why.
  NIGHTSHIFT reads exactly one key (`theme`) and **never writes the file**. The file can hold
  `env`, `permissions` and `hooks`, any of which may contain a token, so everything else is
  discarded at the schema boundary rather than risked in a `doctor` report you might paste into
  a bug thread.
- Font management: detection, plus a **copy-only** install. NIGHTSHIFT reads the installed font
  families out of Windows' font directories, tells you whether a family is present, and can copy
  a font file you already have into your per-user font directory — but it does not write the
  font registry key, does not download fonts, and does not remove them. Nerd Font flagging is a
  name-based heuristic (see "Known limitations"). Non-Windows platforms report `unsupported`
  rather than guessing.
- Shell and Starship integration: the **shell-profile half is done** (see "Implemented"); the
  **Starship half is detection only**. NIGHTSHIFT looks for the `starship` binary on your PATH
  (with `fs`, never by running it) and for a `starship.toml`, reports both, and — when the
  binary is there — adds a guarded Starship init line to its managed block. It does **not**
  generate, edit or read a `starship.toml`, so your prompt's appearance still comes entirely
  from your own Starship config. PowerShell (both 5.1 and 7+) is the only shell written to; a
  detected bash or zsh is reported and never edited.

**Planned (not implemented — do not expect these to work)**

- Downloading a font for you. `font install` takes a local path; there is no network operation
  anywhere in NIGHTSHIFT.
- Registering an installed font with Windows (the `HKCU\...\Fonts` registry value). `font
  install` copies the file and prints the `reg add` command you need to finish.
- Generating a `starship.toml` from a NIGHTSHIFT theme. `shell init` initialises Starship if you
  have it; it never writes its config.
- Editing `.bashrc`, `.zshrc` or any non-PowerShell startup file.
- Linux/macOS terminal adapters (Ghostty, Kitty, iTerm2, GNOME Terminal) — deferred, with the
  unblock conditions recorded on #19. They are buildable but not verifiable on Windows-only CI,
  and this project does not claim support it has not exercised.

**Not planned — decided against, not forgotten**

These were on the roadmap and were closed deliberately. Each issue carries the full reasoning.

- A visual editor / "NIGHTSHIFT Studio" (#20) — it needs a localhost HTTP server, which breaks
  the no-network property the security model rests on, and a browser click is a weaker consent
  signal than the proposal flow. `theme edit` delivers the actual value: change a colour from
  the CLI or the interactive menu, with the new contrast ratios shown before the write.
- Marketplace / community registry (#21) — it would add this project's first network egress, put
  remote content into the one path that writes a file we do not own, and commit a single
  maintainer to indefinite submission review and takedowns. A theme is one JSON file; share it
  by gist or PR and check it with `theme validate`.
- Widget engine (#17) — no render surface. No daemon is permitted, Windows Terminal exposes no
  panel, and `status` and `doctor` already are the dashboard.
- ASCII Art Studio (#22) — contradicts the product's own visual direction, which
  `src/banners/startup.ts` has documented in shipped code since Phase 1 removed the ASCII
  wordmark.

## Requirements

- Windows 11 (Windows Terminal adapter is the only implemented platform adapter).
- Node.js >= 22.12.0. The floor comes from `boxen` 9 (`>=22`) and is bounded by `vitest` 5
  (`^22.12.0 || ^24.0.0 || >=26.0.0`), so 22.0.0-22.11.x could never be exercised by this
  project's own test suite. CI runs 22.12.0, 24, and 26.

## Installation

Not yet published. When it is, the package will be **`nightshift-terminal`** and the command
will still be `nightshift`:

```bash
npm install -g nightshift-terminal
```

> The obvious name, `nightshift-cli`, is taken on npm by an unrelated project that also claims
> the `nightshift` binary. Nothing of ours has ever been published under it — see #39.

Until then, run from source:

```bash
git clone https://github.com/amarjaleelbanbhan/nightshift.git
cd nightshift
npm install
npm run build
npm link   # makes the `nightshift` command available globally
```

## Quick start

```bash
nightshift setup           # show a proposal, then apply it once you approve — nothing is
                           # written before that, and nothing at all without a TTY
nightshift theme list      # see the 4 built-in themes
nightshift theme preview ghost-protocol
nightshift doctor          # check environment + detection status
```

Or do it by hand:

```bash
nightshift init            # create NIGHTSHIFT's own config directory
nightshift theme apply ghost-protocol --dry-run   # show exactly what would change; writes nothing
nightshift theme apply ghost-protocol             # applies to Windows Terminal, with backup/rollback
```

Run `nightshift` with no arguments for the interactive menu.

## CLI command reference

| Command | Description |
|---|---|
| `nightshift` | Interactive home menu (prints status and command suggestions when not run on a TTY) |
| `nightshift init` | Create NIGHTSHIFT's user-level config directory |
| `nightshift setup [--yes]` | Print the full first-run proposal, then apply it on explicit approval. Without a TTY it prints the proposal and writes nothing; `--yes` approves without a prompt |
| `nightshift status` | Show version, OS, detected terminal, active theme, config status |
| `nightshift theme list` | List built-in and user themes |
| `nightshift theme preview <id>` | Preview a theme's color swatches and its WCAG contrast ratios |
| `nightshift theme apply <id> [--dry-run]` | Apply a theme to Windows Terminal (backs up first). `--dry-run` prints exactly which keys would be added or replaced and writes nothing |
| `nightshift theme validate <file>` | Validate a theme JSON file, reporting every schema issue with its field path (exit 1 if invalid). Contrast warnings are advisory and do not fail validation |
| `nightshift theme create` | Create a user theme by cloning an existing one. `--id`, `--name` (both required), `--from <themeId>` (default `ghost-protocol`), `--description`, `--overwrite`. A built-in id is refused under any flag |
| `nightshift theme edit <id> --set <role>=<#RRGGBB>` | Change one or more colours of a user theme. `--set` is repeatable and takes any of the 9 `colors` roles or the 16 `ansi` ones; the new WCAG ratios are printed before the write. `--dry-run` shows the before/after and the new ratios and writes nothing. A built-in theme is refused and the clone command is suggested instead |
| `nightshift theme remove <id>` | Remove a user-created theme. Built-in themes are refused, and so is the active theme (switch away first) |
| `nightshift font list` | List font families installed on this system, flagging probable Nerd Fonts |
| `nightshift font check <family>` | Report whether a font family is installed (exit 1 if it is not) |
| `nightshift font install <path> [--yes]` | Copy a local `.ttf`/`.otf`/`.ttc` file, or a directory of them, into your per-user font directory. Prints the full proposal first and writes nothing without approval; without a TTY it writes nothing and `--yes` approves without a prompt. Does **not** write the font registry value — the finishing `reg add` command is printed |
| `nightshift profile list` | List built-in and user profiles, with active-profile marker |
| `nightshift profile show <id>` | Show a profile's details, including theme resolution |
| `nightshift profile apply <id> [--dry-run]` | Apply a profile's theme to Windows Terminal (backs up first). `--dry-run` previews the change and writes nothing |
| `nightshift profile import <file>` | Import a profile JSON file (`--overwrite` to replace an existing user profile) |
| `nightshift profile export <id>` | Export a profile to JSON (`--output <path>`, `--overwrite`) |
| `nightshift profile remove <id>` | Remove a user-imported profile (built-in profiles can't be removed) |
| `nightshift shell status` | Report the detected shell, the `$PROFILE` path it resolves to, whether NIGHTSHIFT's managed block is present, and whether `starship` and a `starship.toml` were found. Read-only |
| `nightshift shell init [--yes]` | Add or update NIGHTSHIFT's managed block in your PowerShell profile. Prints the **exact diff** and writes nothing without approval; without a TTY it writes nothing and `--yes` approves without a prompt. Backs the file up first. Does **not** write a `starship.toml` |
| `nightshift shell remove [--yes]` | Delete NIGHTSHIFT's managed block, leaving the rest of the profile byte for byte as it was. Same diff-then-approve flow |
| `nightshift doctor` | Diagnose environment and capability detection |
| `nightshift backup create` | Back up the current Windows Terminal `settings.json` |
| `nightshift backup list` | List existing backups |
| `nightshift backup restore <backupId>` | Restore a specific backup by id. It prints the file it is about to overwrite before overwriting it. Also available as `nightshift restore <backupId>` |
| `nightshift completion powershell` | Print a PowerShell Tab-completion script (see "Shell completion" below) |
| `nightshift completion values <kind>` | Print the ids of one kind (`theme`, `profile`, `backup`), one per line. Used by the generated completion script |

Global options: `--no-color` (anywhere on the command line, including after a subcommand),
`--version`, `--help`.

## Exit codes

Scripts can rely on these three values. There are only three, deliberately — the full
reasoning is in `docs/ARCHITECTURE.md`.

| Code | Meaning | Examples |
|---|---|---|
| `0` | The command did what was asked. | `theme list`, `status`, a successful `profile import`, a valid `theme validate`, `setup` declining to write in a non-interactive shell |
| `1` | Runtime failure **and** every usage error. | unknown theme/profile/backup id, an invalid theme file, a font that is not installed, no Windows Terminal `settings.json`, a failed write, a path-traversal attempt, unknown command, missing required argument |
| `2` | NIGHTSHIFT's own `config.json` is corrupt, oversized, or unreadable. | hand-edited invalid JSON, an array at the root, a file that does not match the config schema |

Usage errors share `1` because that is what Commander already exits with; giving them a code of
their own would buy a distinction no caller has asked for.

`2` exists because it is the one distinction a script acts on differently: `1` means *fix your
arguments*, `2` means *NIGHTSHIFT's own state file is broken — delete `config.json` and re-run
`nightshift init`*.

Read-only commands (`status`, `theme list`, `profile list`, `profile show`) still print their
full report when the config is corrupt — they name the problem on stderr and exit `2` rather
than dying, because `status` is one of the commands you run *because* something is wrong.

`doctor` exits non-zero only for a failed check, never for a warning. A missing Claude Code
install, a non-Windows platform, a low-contrast active theme, and a missing theme font are all
advisory and leave the exit code at `0`, so `doctor` stays usable as a scripted health gate. A
corrupt `config.json` is a failure and exits `2`.

## Color output

`--no-color` and `NO_COLOR` (any non-empty value, per no-color.org) both disable ANSI output
entirely — verified to produce zero escape sequences. Either one deliberately overrides
`FORCE_COLOR`: your explicit opt-out wins. Where color carries meaning, a glyph carries it too
(`✓` / `!` / `✗`), and `theme preview` labels every swatch with its own hex value so the
palette still reads with color off.

## Configuration locations

NIGHTSHIFT keeps its own config separate from your terminal's config:

- Windows: `%APPDATA%\nightshift\`
  - `config.json` — active theme id, active profile id, schema version
  - `themes\` — your own custom theme JSON files (validated on load; written by `theme create`)
  - `profiles\` — your own imported profile JSON files (validated on import)
  - `backups\<id>\` — snapshot + metadata for each backup

Windows Terminal's own `settings.json` is located automatically (Microsoft Store package path
or the unpackaged `%LOCALAPPDATA%\Microsoft\WindowsTerminal\settings.json` path) and is only
ever modified by `theme apply`, `profile apply`, `setup` and `restore` — never moved or
replaced wholesale.

## Theme format

A complete, valid theme file. Every key shown as required below is required: `colors` needs all
nine entries and `ansi` needs all sixteen. There is no shorthand and no defaulting — a file
missing them fails `theme validate` with one error per missing key. This example is the full
file, not an excerpt, so it can be copied as-is.

```json
{
  "id": "my-theme",
  "schemaVersion": "1.0",
  "name": "My Theme",
  "colors": {
    "background": "#0A0D0B",
    "foreground": "#DCE6DF",
    "primary": "#65E58B",
    "secondary": "#87938B",
    "success": "#65E58B",
    "warning": "#E8B45C",
    "error": "#F06464",
    "selection": "#24432E",
    "cursor": "#65E58B"
  },
  "ansi": {
    "black": "#0A0D0B",
    "red": "#F06464",
    "green": "#65E58B",
    "yellow": "#E8B45C",
    "blue": "#5AA9E6",
    "purple": "#9D7CD8",
    "cyan": "#5FD6C6",
    "white": "#DCE6DF",
    "brightBlack": "#3A443D",
    "brightRed": "#FF8585",
    "brightGreen": "#8CF0AA",
    "brightYellow": "#FFD089",
    "brightBlue": "#86C5F5",
    "brightPurple": "#BFA3EB",
    "brightCyan": "#8DEADD",
    "brightWhite": "#FFFFFF"
  },
  "typography": { "family": "Cascadia Code", "size": 14 },
  "effects": { "animations": false }
}
```

- Required: `id` (lowercase letters, digits and hyphens only), `schemaVersion` (literal
  `"1.0"`), `name`, `colors` (all 9), `ansi` (all 16). Every color is a 6-digit hex string.
- Optional: `description`, `typography`, `effects`.
- `typography.family` is written into Windows Terminal's `profiles.defaults.font.face` on
  apply. Check it is installed first — `nightshift font check "Cascadia Code"` — because
  Windows Terminal substitutes a different font silently when it is not. `doctor` re-checks
  this for the active theme.

Rather than writing this by hand, clone a working theme and change the colours you care about:

```bash
nightshift theme create --id my-theme --name "My Theme" --from ghost-protocol
nightshift theme edit my-theme --set primary=#65E58B --set background=#0A0D0B --dry-run
nightshift theme edit my-theme --set primary=#65E58B --set background=#0A0D0B
nightshift theme apply my-theme
```

`theme edit` takes any of the nine `colors` roles or the sixteen `ansi` ones by name, refuses an
invalid hex with the same field path `theme validate` reports, and prints the theme's WCAG
contrast ratios *after* the change but *before* the write. Those ratios are advisory: a dim
theme is still a valid theme, so a failing ratio is shown and the write still happens. Editing
the file does not re-apply it — run `theme apply <id>` to see the change in Windows Terminal.

You can also drop a theme JSON file into `%APPDATA%\nightshift\themes\` by hand; it shows up in
`theme list` once it validates.

## Profile format

```json
{
  "id": "my-profile",
  "schemaVersion": "1.0",
  "name": "My Profile",
  "description": "Optional",
  "themeId": "ghost-protocol"
}
```

A profile references a theme by id; it does not embed theme data. Unexpected extra fields
are rejected (strict schema), not silently dropped — a profile can only claim to configure
what NIGHTSHIFT actually supports today, which is a theme selection. The `id` must not collide
with a built-in profile id (`ghost-protocol-default`, `monolith-default`); `profile import`
refuses that outright rather than shadowing a bundled profile.

- `profile import <file>` validates the file (size limit, JSON, schema, theme existence,
  traversal/symlink safety) and copies it into `%APPDATA%\nightshift\profiles\<id>.json`.
  A duplicate id is rejected unless `--overwrite` is passed, and a built-in profile id can
  never be overwritten or removed, with or without that flag.
- `profile export <id>` writes a profile's current validated JSON to a file you choose
  (`--output`, default `<id>.json` in the current directory). It never overwrites an existing
  file without `--overwrite`, and never changes the active profile or theme. Exporting a
  **built-in** profile warns that the file cannot be imported as-is, because the export keeps
  the built-in `id` and import refuses built-in ids: change the `id` field to one of your own
  and the round trip works. That is the supported way to base a custom profile on a shipped one.
- `profile apply <id>` resolves the profile's theme and runs it through the exact same
  backup → write → verify → rollback engine as `theme apply`, then records both the active
  profile and theme in NIGHTSHIFT's config in a single atomic write (so they can never
  disagree, even if a crash happens mid-operation). If updating that config fails after the
  terminal was already changed, the terminal backup is restored too.

## Previewing a write: `--dry-run`

`theme apply` and `profile apply` modify a file NIGHTSHIFT does not own. Both accept
`--dry-run`, which computes the merge, prints the specific keys it would touch, and writes
nothing at all - no `settings.json` change and no backup:

```text
> nightshift theme apply ghost-protocol --dry-run
Dry run - `theme apply ghost-protocol` would change:

  C:\Users\you\AppData\Local\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json
  -> backed up first into C:\Users\you\AppData\Roaming\nightshift\backups

  ~ replace  schemes[] (name "Ghost Protocol")  background #0A0D0B, foreground #DCE6DF + 16 ANSI colors
  + add      profiles.defaults.colorScheme      "Ghost Protocol"
  ~ replace  profiles.defaults.font.face        "Consolas" -> "Cascadia Code"
  ~ replace  profiles.defaults.font.size        12 -> 14

Every other key in that file is preserved untouched.
The write is verified after it lands, and rolled back on failure.

Nothing was written - no settings.json change, and no backup taken.
  -> Re-run without --dry-run to apply: `nightshift theme apply ghost-protocol`
```

Notes:

- `+ add` and `~ replace` are decided by reading your current `settings.json`, so the preview
  tells you whether you are gaining a key or overwriting a value.
- The path shown is the path that gets written. If your `settings.json` is a symlink, the
  resolved target is named along with the link.
- A theme whose font is not installed is reported here too, because applying it is the moment
  that is actionable - Windows Terminal silently substitutes a different font otherwise.
- An unknown theme or profile id still exits **1** under `--dry-run`: you asked about something
  that does not exist. A `settings.json` NIGHTSHIFT would refuse to rewrite is also reported
  here rather than discovered mid-write.
- Default behaviour is unchanged: apply is not interactive and never prompts, so existing
  scripts keep working.

## Shell completion (PowerShell)

Backup ids look like `1794752118976-c615f1f6`, which nobody should have to type. Tab completion
reads them from the live registries:

```powershell
# Try it in the current session
nightshift completion powershell | Out-String | Invoke-Expression

# Install it permanently
nightshift completion powershell >> $PROFILE

# ...or keep $PROFILE tidy by sourcing a separate file
nightshift completion powershell > "$(Split-Path $PROFILE)\nightshift-completion.ps1"
Add-Content $PROFILE '. "$PSScriptRoot\nightshift-completion.ps1"'
```

Then:

```powershell
nightshift theme apply <Tab>     # ghost-protocol monolith redline deep-space --dry-run --help
nightshift restore <Tab>         # 1794752118976-c615f1f6 ...
nightshift profile apply <Tab>   # ghost-protocol-default monolith-default ...
```

Details worth knowing:

- **PowerShell only.** Windows is the only supported platform, so a bash or zsh script would
  imply support NIGHTSHIFT does not have.
- **Re-generate it after upgrading.** The command, subcommand and option table is generated
  from the live command tree at the moment you run `completion powershell`; the *values*
  (theme/profile/backup ids) are always read fresh, so a theme you add today completes today.
- **Cost of a Tab press** (measured, Windows 11, Node 22): ~3 ms for commands and options,
  which need no process; ~400 ms for id completion, which spawns
  `nightshift completion values <kind>` - ~165 ms of Node startup plus ~235 ms for the schema
  validation the registries perform.
- **Options appear on an empty Tab**, not after a bare `-`: PowerShell does not invoke a native
  completer for a lone `-` or `--` (its own completers behave the same way), so an empty Tab
  press is the only one that can surface a flag like `--dry-run`.
- **Font families are deliberately not completed.** Listing them means parsing all 359 font
  files on this machine (`font list` measures 572 ms end to end, and more on a cold cache), and
  the only argument that would benefit is the diagnostic `font check`. A Tab press that slow is
  worse than no completion.

## Backup and restore

Every `theme apply` creates a backup automatically before writing. You can also back up
manually:

```bash
nightshift backup create
nightshift backup list
nightshift backup restore <backupId>   # or `nightshift restore <backupId>`
```

Backups live under `%APPDATA%\nightshift\backups\<id>\` as a raw file snapshot plus a
`metadata.json` (original path, reason, timestamp).

`backup restore` writes to the `originalPath` in that `metadata.json` — which is the point of
the command, so it prints that path *before* the write rather than after it. The automatic
rollback inside `theme apply` and `profile apply` does not trust that field at all: it passes
the path it backed up and refuses to write anywhere else, so an edited `metadata.json` cannot
redirect a rollback nobody asked for (#23).

## Supported platforms

| Platform | Status |
|---|---|
| Windows 11 + Windows Terminal | Supported |
| Windows 11, other terminals | Not implemented |
| Linux | Not implemented |
| macOS | Not implemented |

Capability detection (`doctor`) reports `supported` / `partial` / `unsupported` / `unknown`
based on what it actually finds on disk — it never assumes a feature works just because a
config field exists for it.

## Known limitations

- `theme apply` only targets `profiles.defaults` in Windows Terminal, not per-profile
  overrides.
- `theme apply` edits the keys it changes and leaves the rest of the file byte-for-byte alone,
  with two whitespace exceptions. The edited region is reformatted to the file's own
  indentation, so a scheme entry written on one line (`{ "name": "Campbell" }`) comes back
  expanded across lines, and a same-line trailing comment on the last key of an object it
  appends to moves to the end of that object — the comment text is never lost, only
  re-attached. And a **fully minified** `settings.json` (no line breaks at all) comes back
  pretty-printed in its entirety at 4-space indentation, because there is no line boundary for
  the edit to stop at. Values and comments survive in both cases; only whitespace moves.
- **A symlinked `settings.json` is followed, so NIGHTSHIFT writes outside the path detection
  reported.** If your `settings.json` is a link into a dotfiles repository, `theme apply`,
  `profile apply` and `setup` resolve the link and write the file it points at, which keeps the
  link intact and updates your tracked file. The resolved path is what is named in the success
  message, the `setup` proposal, `status`, `doctor` and the backup it snapshots — if the link
  and its target differ, both are shown. A link whose target is missing is refused with the
  link and the missing target named, rather than being replaced by a regular file.
- **A legacy pre-1.0 `settings.json` whose `profiles` key is a JSON array is refused**, not
  migrated. Converting it to the current `{ defaults, list }` form would mean guessing at a
  migration of your whole profile list. Open Windows Terminal's settings UI once to let it
  migrate the file, then re-run. (This used to be converted silently, which destroyed the
  profile list while reporting success.)
- Nerd Font flagging in `font list` is a **name-based heuristic** — the family name containing
  "Nerd Font" or an "NF" token. Glyph coverage is not inspected, so a patched font under a
  different name is not detected, and a font merely *named* like one is flagged. The command's
  own output says so.
- **`font install` copies a font file; it does not register it with Windows.** A per-user font
  install on Windows is two steps: the file into `%LOCALAPPDATA%\Microsoft\Windows\Fonts`, and a
  value naming it under `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts`. NIGHTSHIFT
  does only the first, because the second needs `reg.exe` or a Win32 call and there is no
  child-process execution anywhere in `src/` (and no new dependency was worth it for one write).
  So after `font install`, `nightshift font check` and `font list` will see the family, and
  applications that read the font registry — including Windows Terminal's font picker — may
  not, until you run the `reg add` command the command prints, or open the font directory and
  use Windows' own right-click **Install**. The proposal states this before you approve it, and
  the result states it again afterwards; `font install` never reports the registration as done.
- `font install` reads from a **local path only** — a file or a directory of font files. It
  never downloads. One file is capped at 32 MB and one directory install at 256 font files,
  only `.ttf`/`.otf`/`.ttc` are accepted, a path containing a `..` segment is refused (the
  proposal has to name a path you can verify), and a file with a font extension but no readable
  family name in its `name` table is refused rather than copied — it could not be verified
  afterwards. Fonts are never removed, and `%WINDIR%\Fonts` (all users) is never written.
- Font detection and installation are Windows-only; other platforms report `unsupported` rather
  than guessing.
- Font *installation* is not implemented. `font list`/`font check` are read-only, and font
  detection is Windows-only (other platforms report `unsupported` rather than guessing).
- **`shell init` writes a PowerShell profile and nothing else.** `.bashrc`, `.zshrc`, `fish`,
  Nushell and `cmd` are not implemented; a detected `SHELL` is reported and never edited, the
  same deliberate PowerShell-only scope the completion script has.
- **`shell init` does not configure Starship, it only initialises it.** NIGHTSHIFT neither
  writes nor reads `starship.toml`, so if you have no Starship config your prompt gets
  Starship's defaults, not anything derived from your NIGHTSHIFT theme. The Starship line is
  added only when the `starship` binary is found on your PATH, and it is wrapped in a
  `Get-Command` guard so uninstalling Starship later does nothing rather than erroring on every
  new shell.
- **The managed block records the active theme id at the time you run `shell init`, and nothing
  updates it afterwards.** `theme apply` does not rewrite your profile — that would be a write
  outside NIGHTSHIFT's config directory with no proposal shown — so `$env:NIGHTSHIFT_THEME`
  goes stale until you re-run `nightshift shell init`.
- **Which shell NIGHTSHIFT thinks you are using is an inference, and `shell status` prints the
  evidence so you can disagree with it.** PowerShell is identified from `PSModulePath` (which
  PowerShell exports to every child process), falling back to which edition already has a
  profile file; there is no `--shell` override. Asking PowerShell for `$PROFILE` directly would
  mean spawning a child process, which this project does nowhere. If neither signal is present
  the command refuses rather than picking an edition, because writing the wrong edition's
  profile produces a file no shell ever loads.
- **`$PROFILE` is resolved from `Documents`, including OneDrive's redirected `Documents`.** If
  Known Folder Move is on, `%OneDrive%\Documents` is preferred over `%USERPROFILE%\Documents`
  (verified on a real machine where it is). A Documents folder redirected somewhere else again,
  by Group Policy or a custom shell-folder registry value, is not detected — `shell status`
  prints the path it resolved, so check it before approving.
- **A `$PROFILE` that does not end with a newline gets one.** The block is appended as whole
  lines, so NIGHTSHIFT adds the missing final newline, and `shell remove` leaves it behind: a
  trailing newline it added and a blank line you wrote are the same byte, and deleting one of
  yours would be worse. Every other byte of the file round-trips exactly.
- **A profile containing two NIGHTSHIFT blocks, or a start marker with no end marker, is
  refused rather than repaired.** NIGHTSHIFT cannot tell which block is its own, and editing
  the wrong lines of a file your shell executes is the failure this whole flow exists to avoid.
  Delete the stray markers by hand and re-run.
- Contrast checking covers 6 color roles against the theme's own background. It does not check
  ANSI colors, color-on-color pairs, or how your actual terminal renders them (transparency,
  acrylic and font smoothing all change the real result).
- No code-signing or marketplace integrity verification — there is no marketplace yet.
- Not tested on Linux or macOS; those adapters do not exist.
- Profiles currently only reference a theme. Font preference, cursor settings, banners,
  widgets, and shell/Claude Code integration fields are deliberately not in the schema yet —
  each will be added once its underlying feature actually exists (see `ROADMAP_STATUS.md`),
  not before.
- Profile import enforces a 64 KB file-size limit as a basic resource-exhaustion guard.

See `SECURITY.md` for the security model and its known gaps.

## Roadmap

See `ROADMAP_STATUS.md` for the current, honestly-tracked status of every phase toward 1.0.0
(automatic setup, font management, ASCII Art Studio, widgets, shell/Starship integration,
Claude Code integration, cross-platform adapters, Studio, marketplace, hardening, CI, docs).

## Contributing

See `CONTRIBUTING.md`.

## License

MIT — see `LICENSE`.
