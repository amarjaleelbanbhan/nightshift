# NIGHTSHIFT

**Your terminal. Your identity.**

NIGHTSHIFT is an open-source developer terminal customization toolkit. It's a CLI-first
configuration layer for the tools you already use — Windows Terminal today, more terminals
and shells later — not a terminal emulator or a replacement for them.

This is an early (`0.2.0`) development release. It implements a real, working foundation:
theme management (including authoring and validation) and profile management, both with safe
apply/rollback to Windows Terminal, guided first-run setup, read-only font detection, and
backup/restore. It does not implement the full long-term vision (marketplace, widgets, Studio,
Claude Code integration, font *installation*, shell integration) — those are tracked honestly
below, not advertised as done. See `ROADMAP_STATUS.md` for the detailed phase-by-phase status of
the full 1.0.0 roadmap.

## Status: Implemented / Partial / Planned

**Implemented**

- Theme engine: 4 built-in themes, Zod-validated schema, list/preview.
- `theme apply`: writes a theme into Windows Terminal's `settings.json`, preserving every
  unrelated key, with an automatic backup-and-rollback on failure.
- Theme authoring: `theme validate` (reports *every* schema problem at once with its field
  path), `theme create` (clones an existing theme into your user themes directory), and
  `theme remove`. A built-in theme id can never be overwritten or removed, with or without
  `--overwrite`.
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
  Integrations / System, with unimplemented sections clearly labeled instead of faked — Setup
  and Fonts are now real entries there, ASCII Art Studio, Widgets, Shell Manager and Claude
  Code are still marked `planned`. Built on `@clack/prompts`; falls back to printing status and
  exiting if run without a real terminal (CI, pipes) instead of hanging.
- One-shot commands (`status`, `doctor`, `theme list`, `profile list`, `font list`,
  `backup list`) render through a shared, terminal-width-aware table/panel design system
  (`cli-table3` + `boxen`) instead of hand-built padded strings.

**Partially implemented**

- Claude Code integration: detection only (`doctor` reports whether `~/.claude/settings.json`
  exists). No settings are read or written.
- Font management: detection only. NIGHTSHIFT reads the installed font families out of Windows'
  font directories and can tell you whether a family is present; it does **not** install,
  download or remove fonts. Nerd Font flagging is a name-based heuristic (see "Known
  limitations"). Non-Windows platforms report `unsupported` rather than guessing.

**Planned (not implemented — do not expect these to work)**

- Font installation (downloading and installing a font for you).
- NIGHTSHIFT Studio (visual editor).
- Marketplace / community registry.
- Widget system, ASCII Art Studio, shell prompt adapters (Starship integration).
- Linux/macOS terminal adapters (Ghostty, Kitty, iTerm2, GNOME Terminal).

## Requirements

- Windows 11 (Windows Terminal adapter is the only implemented platform adapter).
- Node.js >= 22.12.0. The floor comes from `boxen` 9 (`>=22`) and is bounded by `vitest` 5
  (`^22.12.0 || ^24.0.0 || >=26.0.0`), so 22.0.0-22.11.x could never be exercised by this
  project's own test suite. CI runs 22.12.0, 24, and 26.

## Installation

Not yet published to npm. Run from source:

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
nightshift theme apply ghost-protocol   # applies to Windows Terminal, with backup/rollback
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
| `nightshift theme apply <id>` | Apply a theme to Windows Terminal (backs up first) |
| `nightshift theme validate <file>` | Validate a theme JSON file, reporting every schema issue with its field path (exit 1 if invalid). Contrast warnings are advisory and do not fail validation |
| `nightshift theme create` | Create a user theme by cloning an existing one. `--id`, `--name` (both required), `--from <themeId>` (default `ghost-protocol`), `--description`, `--overwrite`. A built-in id is refused under any flag |
| `nightshift theme remove <id>` | Remove a user-created theme. Built-in themes are refused, and so is the active theme (switch away first) |
| `nightshift font list` | List font families installed on this system, flagging probable Nerd Fonts |
| `nightshift font check <family>` | Report whether a font family is installed (exit 1 if it is not) |
| `nightshift profile list` | List built-in and user profiles, with active-profile marker |
| `nightshift profile show <id>` | Show a profile's details, including theme resolution |
| `nightshift profile apply <id>` | Apply a profile's theme to Windows Terminal (backs up first) |
| `nightshift profile import <file>` | Import a profile JSON file (`--overwrite` to replace an existing user profile) |
| `nightshift profile export <id>` | Export a profile to JSON (`--output <path>`, `--overwrite`) |
| `nightshift profile remove <id>` | Remove a user-imported profile (built-in profiles can't be removed) |
| `nightshift doctor` | Diagnose environment and capability detection |
| `nightshift backup create` | Back up the current Windows Terminal `settings.json` |
| `nightshift backup list` | List existing backups |
| `nightshift restore <backupId>` | Restore a specific backup by id |

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

Rather than writing this by hand, clone a working theme and edit it:

```bash
nightshift theme create --id my-theme --name "My Theme" --from ghost-protocol
nightshift theme validate "%APPDATA%\nightshift\themes\my-theme.json"
```

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
  file without `--overwrite`, and never changes the active profile or theme.
- `profile apply <id>` resolves the profile's theme and runs it through the exact same
  backup → write → verify → rollback engine as `theme apply`, then records both the active
  profile and theme in NIGHTSHIFT's config in a single atomic write (so they can never
  disagree, even if a crash happens mid-operation). If updating that config fails after the
  terminal was already changed, the terminal backup is restored too.

## Backup and restore

Every `theme apply` creates a backup automatically before writing. You can also back up
manually:

```bash
nightshift backup create
nightshift backup list
nightshift restore <backupId>
```

Backups live under `%APPDATA%\nightshift\backups\<id>\` as a raw file snapshot plus a
`metadata.json` (original path, reason, timestamp).

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
- Rewriting `settings.json` does not preserve the original file's formatting/key order, only
  its data.
- **A `settings.json` containing `//` comments cannot be applied to.** Windows Terminal
  documents its settings file as JSONC and its own generated file has carried a comment header.
  NIGHTSHIFT writes with `JSON.stringify`, which cannot round-trip comments, so rather than
  silently deleting them it refuses and names the file and the cause. Remove the comments to
  apply a theme. Tracked as issue #14.
- **A legacy pre-1.0 `settings.json` whose `profiles` key is a JSON array is refused**, not
  migrated. Converting it to the current `{ defaults, list }` form would mean guessing at a
  migration of your whole profile list. Open Windows Terminal's settings UI once to let it
  migrate the file, then re-run. (This used to be converted silently, which destroyed the
  profile list while reporting success.)
- Nerd Font flagging in `font list` is a **name-based heuristic** — the family name containing
  "Nerd Font" or an "NF" token. Glyph coverage is not inspected, so a patched font under a
  different name is not detected, and a font merely *named* like one is flagged. The command's
  own output says so.
- Font *installation* is not implemented. `font list`/`font check` are read-only, and font
  detection is Windows-only (other platforms report `unsupported` rather than guessing).
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
