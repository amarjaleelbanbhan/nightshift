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

Ghostty officially supports macOS and Linux, not Windows — NIGHTSHIFT does not claim Ghostty
integration on Windows.
