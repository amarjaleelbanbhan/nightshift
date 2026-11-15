# Architecture

Single TypeScript package, ESM, Node >=18. No monorepo, no backend, no database.

```text
src/
├── index.ts                     CLI entry (Commander wiring)
├── cli/
│   ├── version.ts               reads version from package.json at runtime
│   ├── errors.ts                exit-code contract + the one top-level error handler
│   ├── commands/                one file per command group; printers only — they call
│   │   └── *.ts                 core, print, and set process.exitCode
│   ├── interactive/
│   │   └── home.ts              `nightshift` with no args — @clack/prompts grouped menu
│   └── ui/                      design system: colors.ts (theme-aware semantic tokens),
│                                 table.ts (cli-table3, terminal-width-aware), panel.ts
│                                 (boxen, for one-shot command headers), prompts.ts
│                                 (@clack/prompts wrapper with uniform cancel handling),
│                                 feedback.ts (error/empty/success/warn lines with a next
│                                 step), color-mode.ts (NO_COLOR / --no-color)
├── core/
│   ├── themes/                  schema (Zod), builtin themes, registry (builtin+user),
│   │                             apply.ts (the Windows Terminal apply engine),
│   │                             contrast.ts (WCAG ratios)
│   ├── profiles/                schema (Zod, strict), registry (bundled+user, read-only),
│   │                             manager (import/export/remove, mutating)
│   ├── config/                  NIGHTSHIFT's own config.json: paths + read/write
│   └── capabilities/            platform/terminal/Claude Code detection
├── adapters/
│   └── windows-terminal/        locate settings.json, merge theme into it
├── backup/                      generic file-snapshot backup/restore
├── security/                    resolveSafePath, assertNotSymlink
├── utils/                       atomicWriteFileSync
└── banners/                     themed status panel + clack intro masthead
```

## Why this shape

- **Commands are thin wrappers over `core/`.** `src/core/themes/apply.ts` holds the actual
  apply/verify/rollback engine (`applyThemeFileOnly`, `applyThemeToWindowsTerminal`) as
  exported functions returning a plain result object; `runThemeApply` just prints it. The
  interactive menu (`src/cli/interactive/home.ts`) and the Commander wiring (`src/index.ts`)
  both call the same printer — one implementation, two entry points. Profile apply (0.2.0+)
  follows the same pattern: it is *not* a second theme-application implementation, it resolves
  a profile to a theme and calls the existing engine.

  The engine lived in `src/cli/commands/theme.ts` until it was moved here. Two reasons, both
  concrete rather than tidiness: a command module was the import surface two other modules
  depended on for infrastructure, and `theme.ts` was about to gain `validate`/`create`/`remove`
  on top of an already-mixed file. `core/` must not print, so only the engine moved — every
  `console.log` stayed in `commands/theme.ts`.
- **`recordActiveState()` in `core/themes/apply.ts` is the single rollback path.** After a
  successful write to `settings.json`, it records NIGHTSHIFT's active state and — if that
  config write fails — restores the terminal backup so the two can never disagree. Theme apply
  and profile apply were two copies of this same sequence; a fix applied to one copy and not
  the other was the real hazard, not the duplication. The callers supply only the noun for the
  failure message, their own success message, and the config setter to run.
- **`backup/manager.ts` is generic**, not Windows-Terminal-specific: it snapshots any file path
  with metadata (reason, timestamp, original path) and restores by id. Any future adapter
  (Linux/macOS terminals, Claude Code settings) reuses it rather than reimplementing backup.
- **`security/paths.ts` is the only sanctioned way to turn a user-supplied string (theme id,
  backup id, import filename) into a filesystem path.** Every new file-system entry point
  (profile import/export, future marketplace installs) must route through
  `resolveSafePath`/`assertNotSymlink` rather than `path.join` directly.
- **Registries (`core/themes/registry.ts`, `core/profiles/registry.ts`) merge a builtin source
  and a user source and return a tagged `{ ..., source: "builtin" | "user" }` list.** This
  pattern is reused rather than re-invented for any future asset type (banners, widget packs).
- **No background process.** Every command is a one-shot `node` invocation. Widgets (planned)
  must compute on demand, not via a daemon.
- **`cli/ui/` is the only place that imports `@clack/prompts`, `cli-table3`, or `boxen`
  directly.** Commands call `renderTable`/`panel`/`promptSelect` etc. rather than the raw
  libraries, so a future rendering-library swap (if one is ever justified) touches one module,
  not every command file.
- **`runInteractiveHome()` checks `process.stdin.isTTY && process.stdout.isTTY` before
  entering any prompt.** An interactive `select()` call has nothing to read from in CI/pipes/
  redirected output and will hang waiting for input that never arrives — confirmed by actually
  running it non-interactively during development (it hung until a wrapper timeout killed it)
  before this guard was added. Non-interactive invocations print the same status a real session
  opens with, then return.

## Errors and exit codes

### The contract

| Code | Meaning | Examples |
|---|---|---|
| `0` | The command did what was asked. | `theme list`, `status`, a successful `profile import` |
| `1` | Runtime failure, **and** every usage error. | unknown theme/profile/backup id, no Windows Terminal `settings.json`, a failed write, a path-traversal attempt, unknown command, missing required argument |
| `2` | NIGHTSHIFT's own `config.json` is corrupt, oversized, or otherwise unreadable. | hand-edited invalid JSON, an array at the root, a file that does not match the config schema |

Three values, not a taxonomy. The constants live in `src/cli/errors.ts` and changing one is a
breaking change for anything that scripts the CLI.

**Why usage errors share `1`.** Commander already exits `1` for every usage error it detects —
unknown command, missing required argument, a bare command group printing its help — verified
by running the built binary. Giving usage errors a code of their own would mean
`exitOverride()` and reimplementing Commander's help/version exit behaviour, to buy a
distinction no caller has asked for. Aligning is cheaper and less fragile.

**Why `2` exists.** It is the one distinction a script genuinely acts on differently: exit `1`
means *fix your arguments*, exit `2` means *NIGHTSHIFT's own state file is broken — delete
`config.json` and re-run `nightshift init`*. Those are different remediations, so they get
different codes.

`--help` and `--version` exit `0` and are handled entirely by Commander, which calls
`process.exit()` itself; the top-level handler never sees them.

**`doctor` exits non-zero only for a `fail` check, never for a `warn`.** That line is load
bearing. Most of what `doctor` reports is advisory — no Claude Code install, a non-Windows
platform, a low-contrast active theme — and exiting non-zero for advisories would make
`doctor` useless as a scripted or CI health gate, which is most of its value. A corrupt
`config.json` is not advisory: it breaks every other command. So it is a `fail`, and it reports
the same code `2` that `status` and `theme list` report for the same condition, rather than
inventing a third answer for one fault. An unsupported Node version still wins with `1`,
because nothing else can be trusted under it.

### One handler, one place

`src/index.ts` wraps `parseAsync` in a `try`/`catch` whose body is a single call to
`reportFatal()` in `src/cli/errors.ts`. `index.ts` stays wiring-only; all handler logic lives
in `errors.ts`. Nothing can escape as a raw Node stack trace.

- `reportFatal()` sets `process.exitCode` rather than calling `process.exit()`. This CLI's
  output is tables; `process.exit()` truncates buffered stdout, which would lose the very
  output the user asked for. Every command module follows the same rule.
- `describeError()` converts *any* thrown value — `Error`, `NightshiftError`, or a thrown
  string — into a message and a code, so an unexpected throw type cannot produce
  `[object Object]` or an empty line.
- `reportFatal()` renders through `errorMessage()` from `src/cli/ui/feedback.ts`, so an escaped
  throw gets the same `✗ message` / `→ next step` shape as a command's own failure. The glyph,
  not the color, is what carries the state when color is off.
- Command modules therefore **propagate** rather than each inventing their own catch-and-print.
  `runRestore` (`src/cli/commands/backup.ts`) is the reference case: it catches only to attach a
  `NightshiftError` hint ("Run `nightshift backup list`…") and rethrows. An unknown backup id, a
  missing snapshot, and a `UnsafePathError` from `src/security/paths.ts` all reach the top-level
  handler, which remains the only place that prints a failure and sets the exit code. Catching
  to add context and rethrow is fine; catching to print is what creates a second handler.

### Corrupt config: degrade *and* report, rather than fail

`src/core/config/store.ts` exposes two readers over one `safeParse` implementation:

- `tryReadConfig()` never throws; it returns `{ ok: false, error }`.
- `readConfig()` throws what `tryReadConfig()` reports.

Read-only commands (`status`, `theme list`, `profile list`, `profile show`) use
`tryReadConfig()`. They print
their full report, show the active theme/profile as `none`, name the corruption on stderr with
the file path and the remedy, and exit `2`. The reason is behavioural, not stylistic: `status`
is one of the commands a user runs *because* something is wrong, so dying on the broken file is
the worst possible moment to stop being useful. Degrading silently would be worse still, which
is why the exit code and the stderr message are not optional — "degrade" here means *keep
working*, not *pretend it is fine*.

Commands that write the config back use `readConfig()` and fail. Degrading to defaults on a
write path would overwrite the user's file with invented values and silently discard their
active theme.

A corrupt `config.json` never reaches a `JSON.parse`/`ZodError` stack trace: `tryReadConfig()`
wraps syntax and schema failures in `ConfigCorruptError`, whose message names the path, the
specific field problems, and the fix. An oversized file passes through as
`FileTooLargeError` (`src/security/limits.ts`) unwrapped — that message already names the file,
its size, and the limit — and maps to the same exit code.

`doctor` reports the corruption as a failed check with the full message in the table, and still
runs every other check, so the command a user reaches for when things are broken both keeps
working and names the problem.

### Color

`--no-color` is registered as a Commander option on the root program in `src/index.ts`, so it
appears in `--help`. It is *read* in `src/cli/ui/color-mode.ts` by scanning `process.argv` at
import time rather than from `program.opts()`, because `chalk.level` must be set before any
command renders and Commander only hands over parsed options once an action is already running.
Commander 13 resolves a root option that appears after a subcommand against the parent
(verified: `theme list --no-color` parses), so one registration covers every position.

`NO_COLOR` (any non-empty value, per no-color.org) and `--no-color` both set `chalk.level = 0`,
which deliberately **overrides** `FORCE_COLOR`. chalk/supports-color lets `FORCE_COLOR` defeat
`NO_COLOR`; letting the user's explicit opt-out win is both the right default and the only way
the behaviour is testable without a TTY — see `tests/integration/no-color.test.ts`.

## What's deliberately NOT abstracted yet

- There is one platform adapter (Windows Terminal). An `Adapter` interface is not introduced
  until a second real adapter exists — speculative interfaces for a single implementation
  are exactly the kind of premature abstraction this project avoids.
- There is no plugin/extension loader. Widget definitions, marketplace assets, and banners are
  data (JSON), not code, by design (see `docs/SECURITY-MODEL.md`).
