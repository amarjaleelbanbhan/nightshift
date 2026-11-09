# NIGHTSHIFT

**Your terminal. Your identity.**

NIGHTSHIFT is an open-source developer terminal customization toolkit. It's a CLI-first
configuration layer for the tools you already use — Windows Terminal today, more terminals
and shells later — not a terminal emulator or a replacement for them.

This is an early (`0.1.0`) development release. It implements a real, working foundation:
theme management with safe apply/rollback to Windows Terminal, and backup/restore. It does
not implement the full long-term vision (marketplace, widgets, Studio, Claude Code
integration) — those are tracked honestly below, not advertised as done.

## Status: Implemented / Partial / Planned

**Implemented**

- Theme engine: 4 built-in themes, Zod-validated schema, list/preview.
- `theme apply`: writes a theme into Windows Terminal's `settings.json`, preserving every
  unrelated key, with an automatic backup-and-rollback on failure.
- Backup and restore for Windows Terminal's `settings.json`.
- Environment/capability detection (`doctor`, `status`) — reports what was actually detected,
  not what's assumed.
- `profile list` against bundled, schema-validated profile definitions.
- Interactive home menu (`nightshift` with no args) with unimplemented sections clearly
  labeled instead of faked.

**Partially implemented**

- Profiles: schema + listing only. Profile `apply`/import/export are not built yet.
- Claude Code integration: detection only (`doctor` reports whether `~/.claude/settings.json`
  exists). No settings are read or written.

**Planned (not implemented — do not expect these to work)**

- NIGHTSHIFT Studio (visual editor).
- Marketplace / community registry.
- Widget system, ASCII Art Studio, shell prompt adapters (Starship integration).
- Linux/macOS terminal adapters (Ghostty, Kitty, iTerm2, GNOME Terminal).

## Requirements

- Windows 11 (Windows Terminal adapter is the only implemented platform adapter).
- Node.js >= 18.

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
nightshift init            # create NIGHTSHIFT's own config directory
nightshift theme list      # see the 4 built-in themes
nightshift theme preview ghost-protocol
nightshift theme apply ghost-protocol   # applies to Windows Terminal, with backup/rollback
nightshift doctor          # check environment + detection status
```

Run `nightshift` with no arguments for the interactive menu.

## CLI command reference

| Command | Description |
|---|---|
| `nightshift` | Interactive home menu |
| `nightshift init` | Create NIGHTSHIFT's user-level config directory |
| `nightshift status` | Show version, OS, detected terminal, active theme, config status |
| `nightshift theme list` | List built-in and user themes |
| `nightshift theme preview <id>` | Preview a theme's color swatches |
| `nightshift theme apply <id>` | Apply a theme to Windows Terminal (backs up first) |
| `nightshift profile list` | List bundled profiles |
| `nightshift doctor` | Diagnose environment and capability detection |
| `nightshift backup create` | Back up the current Windows Terminal `settings.json` |
| `nightshift backup list` | List existing backups |
| `nightshift restore <backupId>` | Restore a specific backup by id |

## Configuration locations

NIGHTSHIFT keeps its own config separate from your terminal's config:

- Windows: `%APPDATA%\nightshift\`
  - `config.json` — active theme id, schema version
  - `themes\` — your own custom theme JSON files (validated on load)
  - `backups\<id>\` — snapshot + metadata for each backup

Windows Terminal's own `settings.json` is located automatically (Microsoft Store package path
or the unpackaged `%LOCALAPPDATA%\Microsoft\WindowsTerminal\settings.json` path) and is only
ever modified by `theme apply`, never moved or replaced wholesale.

## Theme format

```json
{
  "id": "ghost-protocol",
  "schemaVersion": "1.0",
  "name": "Ghost Protocol",
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
  "ansi": { "...": "16 ANSI colors, see src/core/themes/schema.ts" },
  "typography": { "family": "Cascadia Code", "size": 14 },
  "effects": { "animations": false }
}
```

Drop a validated theme JSON file into `%APPDATA%\nightshift\themes\` to make it show up in
`theme list`.

## Profile format

```json
{
  "id": "ghost-protocol-default",
  "schemaVersion": "1.0",
  "name": "Ghost Protocol (Default)",
  "themeId": "ghost-protocol"
}
```

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
- No code-signing or marketplace integrity verification — there is no marketplace yet.
- Not tested on Linux or macOS; those adapters do not exist.

See `SECURITY.md` for the security model and its known gaps.

## Roadmap

1. Profile `apply`/import/export, built on the same validated schema.
2. ASCII Art Studio (banner import/export) using a maintained text-to-ASCII library.
3. Static GitHub-hosted marketplace registry (themes/profiles only, no executable content).
4. NIGHTSHIFT Studio (React + Vite), reusing this package's core validation/config logic.

## Contributing

See `CONTRIBUTING.md`.

## License

MIT — see `LICENSE`.
