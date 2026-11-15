# Platform compatibility

Status is based on what has actually been run and verified, not on what an adapter file
exists for. "Tested" means executed on that OS during this project's development; nothing
here has been tested on Linux or macOS because development has only happened on Windows 11.

| Platform | Terminal | Status | Tested on |
|---|---|---|---|
| Windows 11 | Windows Terminal | Supported | Windows 11 Pro 10.0.22631 |
| Windows 11 | PowerShell 7 / Windows PowerShell 5.1 | Shell detection only; no shell-integration adapter yet | Windows 11 Pro 10.0.22631 |
| Windows 11 | CMD | Not implemented | — |
| Linux (any distro) | Ghostty / Kitty / GNOME Terminal | Not implemented | — |
| macOS | Ghostty / iTerm2 / Apple Terminal | Not implemented | — |
| WSL | (any) | Not implemented — WSL is a separate Linux environment from the Windows host and needs its own detection path | — |

Capability detection (`src/core/capabilities/detect.ts`) reports `supported` / `partial` /
`unsupported` / `unknown` based on what it actually finds on disk (e.g. whether
`settings.json` exists at a known Windows Terminal path). It does not report `supported`
just because a schema field exists for a setting.

## Font detection

| Platform | Status | Tested on |
|---|---|---|
| Windows 11 | Supported — reads `%LOCALAPPDATA%\Microsoft\Windows\Fonts` and `%WINDIR%\Fonts` | Windows 11 Pro 10.0.22631 (200 families found) |
| macOS, Linux, anything else | `unsupported` — reported as such, not reported as "no fonts" | — |

`src/core/fonts/detect.ts` parses each font file's sfnt `name` table rather than consulting the
registry, so a font installed by dropping a file into one of those two directories is found, and
a font registered in the registry but absent from both directories is not. Neither directory
present reports `unknown` rather than an empty list — "no font directory could be located" and
"no fonts installed" are different answers and must not look the same.

Nerd Font flagging is a name-based heuristic (family name contains "Nerd Font" or an "NF"
token). Glyph coverage is never inspected, on any platform. `font list` prints that caveat with
its own output.

Font *installation* is not implemented on any platform. It writes outside NIGHTSHIFT's own
config directory, so it needs the shown-proposal-and-approval flow that `setup` has, and that
has not been built.

Ghostty officially supports macOS and Linux, not Windows — NIGHTSHIFT does not claim Ghostty
integration on Windows.
