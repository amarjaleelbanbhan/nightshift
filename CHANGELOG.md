# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added

- **`doctor` reports when Claude Code's theme disagrees with your terminal's (#18).** Claude
  Code has its own light/dark `theme` setting; when it contradicts the active NIGHTSHIFT theme's
  background, Claude Code renders light-theme syntax colours on a dark background and nothing
  previously told the user why — you change your *terminal* theme and a *different tool* starts
  looking wrong. The comparison reuses the WCAG relative-luminance maths already in
  `src/core/themes/contrast.ts` rather than adding a second notion of brightness, splitting at
  the 0.179 midpoint where black and white text have equal contrast.

  The scope is **read-only and permanently so**, recorded as a decision on #18. NIGHTSHIFT reads
  exactly one key and never writes `~/.claude/settings.json`: writing another tool's config
  carries the full proposal-and-approval requirement and a real blast radius, for no value
  NIGHTSHIFT can add. The file is Zod-parsed to that single key, so `env`, `permissions` and
  `hooks` — any of which may hold a token — are discarded at the schema boundary and cannot
  reach a `doctor` report. A malformed or oversized file is reported as such rather than
  crashing the one command people run when something is already wrong, and the whole check is
  advisory: it never changes `doctor`'s exit code.

## [0.4.0] - 2026-11-15

`theme apply` now works on the `settings.json` Windows Terminal actually ships, and returns it
as the user's own file rather than a regenerated one.

### Added

- **JSONC support for Windows Terminal's `settings.json` (#14).** The file is documented as
  JSONC, the one Windows Terminal generates opens with a `//` header, and many people annotate
  theirs. All of those were previously **refused** — `theme apply`, `profile apply` and `setup`
  could not run at all on a commented settings file. They now read it (comments, block
  comments and trailing commas) via `jsonc-parser`.
- **The write preserves the file.** `theme apply` no longer round-trips through
  `JSON.stringify`; it applies targeted text edits to just the keys it changes
  (`schemes[]`, `profiles.defaults.colorScheme`, the font). Comments, key order, indentation
  width, CRLF and a UTF-8 BOM all survive, and re-applying an already-applied theme leaves the
  file byte-identical. The reformat is confined to the edited region, so a one-line scheme
  entry expands across lines and a trailing comment on the last key of an object that gains a
  key is re-attached to the end of that object — no comment text is lost. A fully minified
  settings.json is the one file that comes back pretty-printed as a whole, since there is no
  line boundary for the edit to stop at; both exceptions are documented in `README.md`.
  `tests/integration/jsonc-settings.test.ts` pins all of this against a realistic commented,
  two-space, trailing-comma settings file.
- The write collapses **pre-existing duplicate entries** for the theme's own scheme name, so a
  hand-edited file holding two `"Ghost Protocol"` entries comes out holding one. Replacing only
  the first would have left the stale duplicate that Windows Terminal actually honours, and
  would have disagreed with what the object merge — and therefore `--dry-run` — reported.
- A pathologically nested settings.json (`jsonc-parser` is recursive-descent, where the
  replaced `JSON.parse` was iterative) is reported as a NIGHTSHIFT error naming the file,
  rather than a bare `RangeError: Maximum call stack size exceeded`. Nothing is written before
  the parse, so this was always a message problem rather than a data one.

### Security

- **An automatic rollback can no longer be redirected by backup metadata (#23).**
  `restoreBackup()` takes an optional `expectedPath` and refuses to write anywhere else; every
  internal rollback passes the path it backed up. The destination otherwise comes from a
  `metadata.json` on disk, which is Zod-validated and symlink-checked but still a string from a
  file. The user-driven `nightshift backup restore` deliberately still uses the recorded path —
  "put it back where it came from" is the request — but now **prints the destination before the
  write** and pins the write to the path it printed. This is defence in depth, not a privilege
  boundary: editing that metadata already needs the same rights the redirected write would
  grant.

### Changed

- `restore` is now also registered as **`nightshift backup restore <id>`**, which is what
  anyone holding an id from `backup list` types. The top-level `nightshift restore <id>` still
  works and is unchanged.
- A truncated or malformed `settings.json` is reported with the **line number** of the first
  parse error. `jsonc-parser` recovers from syntax errors and returns a partial object, so the
  parse errors are inspected rather than caught — a half-readable file is refused instead of
  having a theme applied to the half that parsed.
- A UTF-8 BOM is separated and re-attached rather than stripped, so a file Notepad saved as
  "UTF-8 with BOM" is not silently converted on the first `theme apply`.

## [0.3.0] - 2026-11-15

A hardening release. It does not add the 1.0.0 feature scope — Studio, the marketplace,
widgets, shell integration, font installation and cross-platform adapters are all still
unimplemented and tracked honestly in `ROADMAP_STATUS.md`. What it does is make the existing
foundation safe to rely on: four defects that corrupted or misreported user configuration
while printing success, every dependency advisory cleared, a documented exit-code contract,
and a test suite that grew from 73 to 416.

### Breaking

- **`engines.node` is now `>=22.12.0`**, corrected from a false `>=18.0.0`. Installing on
  Node 18 or 20 will fail with `EBADENGINE`. The floor comes from `boxen` 9 (`>=22`) and is
  bounded by `vitest` 5 (`^22.12.0 || ^24.0.0 || >=26.0.0`), so 22.0.0–22.11.x could never be
  exercised by this project's own test suite. CI runs 22.12.0, 24 and 26.

### Security

- `zod` 3.25.76 → 4.6.7, clearing the high-severity runtime advisory GHSA-mrhx-c7xc-m3w5
  (memory exhaustion validating oversized constrained collections). The advisory's mechanism
  lands directly on this project's main attack surface — validating user-supplied JSON theme
  and profile files. This reverses the decision recorded in 0.2.0 not to upgrade; see
  `docs/SECURITY-MODEL.md` for why that earlier reasoning did not support its conclusion.
- `vitest` 3 → 5.1.0, clearing two critical `tinypool` prototype-pollution-to-RCE advisories
  (devDependency only).
- `minimatch` pinned to `^11.0.8` under `@typescript-eslint/typescript-estree` via `overrides`.
  `@typescript-eslint` 8.72.2 does not clear this natively, and `npm audit fix --force`
  "resolves" it by downgrading the parser to 6.15.0. Note npm does not record root `overrides`
  in the lockfile — the pin survives only as the resolved entry, which is why CI now uses
  `npm ci`.
- **`npm audit` went from 10 findings (1 high, 2 critical, 7 moderate) to 0.**
- JSON reads are now capped at 64 KB by a shared guard that `stat`s before reading, so an
  oversized file is never allocated. Applied to user themes, user profiles, `config.json` and
  backup metadata. Windows Terminal's own `settings.json` is deliberately uncapped — refusing
  a legitimately large file owned by another application would be worse than reading it.
- Backup metadata is now Zod-validated and symlink-checked before a restore writes to it.

### Added

- `nightshift setup [--yes]` — guided first run. Shows a proposal of every path it will touch,
  then requires explicit approval. In a non-interactive environment it prints the proposal and
  **writes nothing**, which is structural rather than a check: the proposal is built and
  rendered by functions that perform no writes at all.
- `nightshift theme validate <file>` — reports **every** schema issue with its field path, not
  just the first. Contrast problems are advisory and do not fail validation.
- `nightshift theme create` / `nightshift theme remove <id>` — clone an existing theme as a
  starting point; remove user themes only. A built-in id can never be overwritten or removed
  under any flag, and the active theme cannot be removed without switching away first.
- `nightshift font list` / `nightshift font check <family>` — font detection. Families are read
  from each file's sfnt `name` table rather than its filename, because Windows ships Consolas
  as `consola.ttf` and Cascadia Code as `CascadiaCode.ttf`. Nerd Font identification is a
  name-based heuristic and the output says so.
- `nightshift completion powershell` — Tab completion for commands, options, and dynamically
  for theme, profile and backup ids read from the live registries. Backup ids look like
  `1794753438226-70a6e3cc`, so the documented recovery path previously required hand-copying
  one.
- `theme apply --dry-run` and `profile apply --dry-run` — show the specific keys that would be
  added or replaced, with before and after values, and write nothing.
- **A documented exit-code contract**: `0` success, `1` runtime and usage failure, `2`
  NIGHTSHIFT's `config.json` corrupt or unreadable. Documented in `README.md` and
  `docs/ARCHITECTURE.md`.
- `--no-color` flag alongside `NO_COLOR`.
- WCAG contrast validation in `theme preview`, `doctor` and `theme validate`. All four built-in
  themes pass AA 4.5:1 on all 24 colour pairs; the narrowest margin is `redline`'s primary at
  4.98:1.
- Coverage measurement with a split threshold — a loose global tripwire plus a strict gate on
  the engine (`src/{core,adapters,backup,security,utils}`), enforced in CI.
- `prepublishOnly`, `format:check`, `clean` and `test:coverage` scripts, and
  `docs/development/RELEASE_CHECKLIST.md`.
- `repository`, `bugs`, `homepage` and `keywords` in `package.json`.

### Changed

- **CLI startup is roughly 73% faster**: `--version` went from ~843 ms to ~229 ms median.
  Command modules are now imported lazily, and — the larger half — `cli/errors.ts` was
  loading zod on *every* invocation to satisfy a single `instanceof`, costing 300 ms. Moving
  that error class to a zero-dependency module took the eager import set from 326 ms to 55 ms.
- Modern CLI redesign (previously unreleased): interactive menu now uses `@clack/prompts`
  (replacing `@inquirer/prompts`) with grouped Workspace/Customization/Integrations/System
  navigation instead of a flat command list. One-shot commands render through a shared,
  terminal-width-aware table (`cli-table3`) and a themed panel (`boxen`) instead of hand-built
  padded strings. The two-line ASCII wordmark banner is gone; `status` shows a compact themed
  identity panel.
- The Windows Terminal apply engine moved out of the command module into
  `src/core/themes/apply.ts`, and its duplicated backup/rollback sequence is now one function.
  Verified behaviour-preserving by differential probe across seven engine paths rather than by
  test pass alone.
- `doctor` reports a corrupt config as a failure instead of `✓ initialized`. Advisory findings
  still exit 0 so it stays usable as a scripted health gate.
- The npm package ships 44 files instead of 77. The `files` array declared two directories
  that did not exist, and 36 of the packed files were **dangling source maps** pointing at a
  `src/` that does not ship — broken maps are worse than absent ones.
- CI now runs `npm ci` (so the lockfile is enforced), a Node 22.12.0/24/26 matrix on
  `windows-latest`, `prettier --check`, `npm audit`, and the coverage thresholds.
- Added `.gitattributes` normalising line endings to LF. Without it, `actions/checkout` on a
  Windows runner checked out CRLF against Prettier's `lf` default, so `format:check` passed
  locally and failed on CI for every file.

### Fixed

Four of these corrupted or misreported user state **while reporting success**.

- **A legacy-format `profiles` array in `settings.json` was silently flattened** into
  `{"0":…,"1":…}`, destroying the user's entire profile list, while `theme apply` returned
  `{ok: true}`. The cause was `typeof [] === "object"`. The same unguarded pattern appeared
  three times in that function and all three now route through one check. NIGHTSHIFT now
  refuses and tells the user to let Windows Terminal migrate the file, rather than guessing at
  a migration.
- **A symlinked `settings.json` was severed and replaced with a regular file**, orphaning a
  dotfiles-tracked file with stale content, while reporting success. Rollback could not help,
  because by then the path was a regular file. The link is now followed: the resolved file is
  written and backed up, and output names both paths.
- **`backup list` failed intermittently** on malformed metadata, because the `.sort()` sat
  outside the `try`. Order-dependent: one bad entry returned results, two threw. This is the
  command the restore error message tells users to run.
- **A theme requesting an uninstalled font was applied silently**, with Windows Terminal
  substituting another font so the terminal never matched the preview. `doctor` and
  `theme apply --dry-run` now report it. This affects the default theme on a stock machine:
  `ghost-protocol` requests Cascadia Code.
- A corrupt or hand-edited `config.json` crashed **every** command with a raw Node stack trace.
  There is now a single top-level handler, and readers degrade and report while writers fail —
  degrading on a write path would overwrite the user's file with invented values.
- `doctor` reported `✓ Node.js version ... (requires >=18)`, so an unsupported runtime passed
  the one check meant to catch it, contradicting npm's own `EBADENGINE` refusal.
- **Every table overflowed the terminal by exactly +2 columns** at every width, with a hard
  ~57-column floor, and `COLUMNS=20` fell back to 100 — rendering the widest table for the
  narrowest terminal. Invisible in piped output.
- **`NO_COLOR` had no effect at all.** Two causes: chalk lets `FORCE_COLOR` override it, and
  `boxen` snapshots `chalk.level` at import time. The naive test passed because piped output
  is already ANSI-free.
- The theme JSON example in `README.md` could not be used: its `ansi` shorthand produced 16
  validation errors against the real schema. Harmless prose until `theme validate` shipped and
  made the block something a user would paste.
- `profile export` produced a file `profile import` refused, and the refusal hint recommended
  `profile export` — following it looped forever.
- `removeProfile` deleted the profile file *before* the config read that could throw, leaving
  the file gone and the config un-updated.
- Two integration tests were failing intermittently at vitest's 5000 ms default — a different
  pair each run — because each binary spawn cost ~850 ms. A pre-existing flakiness nobody had
  caught.
- The interactive home screen would hang indefinitely on non-TTY stdin (CI, pipes) because the
  prompt library had nothing to read. It now detects this and prints status instead.
- A test asserting NIGHTSHIFT never claims platform support without evidence was wrapped in
  `if (platform !== "win32")`, so on the only supported platform it never executed. It
  verified nothing while reporting green.

### Known limitations

Unchanged from 0.2.0 unless listed above. Still true: the interactive arrow-key experience is
unverified by automation (`@clack/prompts` needs a real TTY); `settings.json` containing
comments cannot be applied; Linux and macOS adapters do not exist and cannot be tested on the
development machine; and font *installation* is not implemented. See `README.md` and
`ROADMAP_STATUS.md`.

## [0.2.0] - 2026-11-09

### Added

- Profile Manager: `profile show <id>`, `profile apply <id>`, `profile import <file>`,
  `profile export <id>`, `profile remove <id>`. `profile apply` reuses the same backup →
  write → verify → rollback engine as `theme apply` (no second implementation).
- `activeProfileId` added to NIGHTSHIFT's config schema, additive and backward-compatible:
  a 0.1.0 config file without the field loads with `activeProfileId: null`. Applying a theme
  standalone clears `activeProfileId`; applying a profile sets both fields atomically in one
  write.
- Profile registry now also loads user-imported profiles from `%APPDATA%\nightshift\profiles\`
  and merges them with bundled ones; a user profile can never shadow a built-in id.
- Profile schema is now strict — unexpected fields are rejected rather than silently dropped.
- `status`/`doctor` report active profile and user-profile-directory health (valid count,
  invalid/unreadable files).
- Interactive Profile Manager menu: list/apply/import/export/remove.
- Investigated and documented (not blindly "fixed") the `npm audit` Zod advisory
  (`GHSA-mrhx-c7xc-m3w5`) — see `docs/SECURITY-MODEL.md`.
- `docs/ARCHITECTURE.md`, `docs/PLATFORM-COMPATIBILITY.md`, `docs/SECURITY-MODEL.md`,
  `docs/CONFIGURATION-FORMATS.md`, `ROADMAP_STATUS.md`.
- 40 new tests (unit, import/export, apply integration, CLI) covering the above.

### Fixed

- `theme apply`'s backup-creation step is now wrapped so a backup failure returns a clean
  error instead of an uncaught exception.

## [0.1.0] - 2026-11-09

Initial development release. See README.md for a precise list of what's implemented,
partially implemented, and planned.

### Added

- CLI foundation (`nightshift --version`, `--help`, `init`, `status`, `doctor`).
- Theme engine with Zod-validated schema and four built-in themes: Ghost Protocol, Monolith,
  Redline, Deep Space.
- `theme list`, `theme preview`, `theme apply`.
- Windows Terminal adapter: capability detection, settings merge preserving unrelated keys,
  backup-before-write with automatic rollback on verification failure.
- `backup create`, `backup list`, `restore <id>`.
- Minimal profile schema and `profile list` (bundled profiles only; apply/import are planned).
- Interactive home menu (`nightshift` with no arguments) distinguishing implemented sections
  from planned ones.
- Unit, integration, and security test suites (path traversal, malformed imports, backup
  restore, Windows Terminal settings merge).
