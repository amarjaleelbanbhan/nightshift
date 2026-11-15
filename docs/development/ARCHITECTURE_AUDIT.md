# Architecture Audit (A1)

Owner: `architecture-agent` (see `.claude/agents/architecture-agent.md`)
Branch: `feat/nightshift-1.0.0`
Audited: 2026-11-15, after Wave A (security-agent: Zod 4, `src/security/limits.ts`) landed.
Scope: `src/` (24 files, ~1,700 LOC). Line numbers are against the tree at audit time.

Findings fixed during the A2 wave are marked **Fixed in A2**. Three findings (A-4, A-5, A-6)
were deferred because another agent held their files; those files were released afterwards and
the findings are marked **Fixed in Wave C-prep**.

**Counts: 2 High · 5 Medium · 4 Low (11 total).** Nine fixed (A-1 to A-8 and A-11); two left
open with reasons recorded below (A-9, A-10).

---

## High

### A-1 — No top-level error handler (= G4)

**Evidence:** `src/index.ts:91` — the file ends at `await program.parseAsync(process.argv)` with
no `try`/`catch`.

**Impact:** any throw that escapes a command action reaches Node's default handler, which prints
the raw stack trace and the Node version banner. Measured before the fix:

```
$ APPDATA=$NSTMP node dist/index.js status
SyntaxError: Expected property name or '}' in JSON at position 2 (line 1 column 3)
    at JSON.parse (<anonymous>)
    at readJsonFileWithLimit (file:///D:/CTP/dist/security/limits.js:30:17)
    at readConfig (file:///D:/CTP/dist/core/config/store.js:28:31)
    ...
Node.js v26.12.1
```

**Recommendation:** one handler in `src/index.ts` delegating to a new `src/cli/errors.ts`.
`src/index.ts` stays wiring-only.

**Fixed in A2.**

### A-2 — `readConfig()` parses with no error handling (= G5)

**Evidence:** `src/core/config/store.ts:29-35` — `configSchema.parse(readJsonFileWithLimit(path))`.
Three failure modes, none handled: `FileTooLargeError` from `src/security/limits.ts:32`,
`SyntaxError` from `JSON.parse`, `ZodError` from `.parse`.

**Impact:** a corrupt or hand-edited `config.json` crashes every command that reads it —
`status` (`src/cli/commands/status.ts:12`), `theme list` (`src/cli/commands/theme.ts:15`),
`profile list`/`show` (`src/cli/commands/profile.ts:21,52`), `profile remove`
(`src/core/profiles/manager.ts:134`) — via A-1, as a stack trace. `config.json` is a file the
README invites users to inspect, so hand-edited corruption is an expected input, not a freak case.

**Recommendation:** `safeParse`; a non-throwing `tryReadConfig()` for read-only commands that
must stay usable while the config is the broken thing; a throwing `readConfig()` for writers.

**Fixed in A2.**

---

## Medium

### A-3 — Exit codes undocumented and undifferentiated (= G6)

**Evidence:** every failure path sets `process.exitCode = 1` —
`src/cli/commands/backup.ts:11,44`, `src/cli/commands/profile.ts:47,115,124,137,147`,
`src/cli/commands/theme.ts:33,161`, `src/cli/commands/doctor.ts:83`. No exit-code section in
`README.md` or `docs/ARCHITECTURE.md`.

**Impact:** a script cannot distinguish "you asked for a theme that does not exist" (fix the
argument) from "NIGHTSHIFT's own config file is broken" (delete it and re-init). Measured
Commander behaviour is uniformly 1 for usage errors (unknown command, missing required
argument, bare command group), so 1 is already overloaded.

**Recommendation:** publish a three-value contract and align with Commander rather than
override it. **Fixed in A2** (contract in `docs/ARCHITECTURE.md`).

### A-4 — `doctor` cannot see config corruption

**Evidence:** `src/cli/commands/doctor.ts:52-55` — the "NIGHTSHIFT config" check is
`isInitialized() ? "ok" : "warn"`, and `isInitialized()` is `fs.existsSync` only
(`src/core/config/store.ts:25-27`).

**Impact:** `doctor` is the command a user runs when something is wrong. A corrupt
`config.json` exists, so `doctor` reports it as `✓ initialized` — the one diagnostic that
should name the problem is the one that hides it. (It does survive the corruption, because it
never calls `readConfig()`; that is luck, not design.)

**Recommendation:** have the check use `tryReadConfig()` (added in A2) and report
`✗ corrupt — <path>` with the actionable message.

**Fixed in Wave C-prep.** The check is now a three-way: not initialized -> `warn`; readable ->
`ok`; unreadable -> `fail`, with the full `ConfigCorruptError` message in the table. `doctor`
exits `2` for a corrupt config (and still `0` for every advisory `warn`) - see "Errors and exit
codes" in `docs/ARCHITECTURE.md` for why a diagnostic should report a fault it found.

### A-5 — Duplicated "apply, then record active state, roll back if recording fails" block

**Evidence:** `src/cli/commands/theme.ts:131-146` and `src/cli/commands/profile.ts:85-100` are
the same 16-line sequence (`if (!isInitialized()) initializeConfig()` → setter → `catch` →
best-effort `restoreBackup(fileResult.backupId)` → return a "applied but config write failed,
settings restored" message). They differ only in which setter runs (`setActiveTheme` vs
`setActiveProfileAndTheme`) and one noun in the message.

**Impact:** this is the rollback path — the code that protects the user's `settings.json`. Two
copies means a fix to one silently does not reach the other. It also contradicts invariant 1
("never a second implementation of the same operation"), which the profile-apply design notes
in `docs/ARCHITECTURE.md` explicitly claim to honour.

**Recommendation:** one `recordActiveState(fileResult, setter)` helper, probably in `theme.ts`
next to `applyThemeFileOnly`, called by both.

**Fixed in Wave C-prep.** Both copies now call `recordActiveState()` in the new
`src/core/themes/apply.ts`. The callers supply only the failure-message noun, their own success
message, and the config setter; the init/write/rollback sequence exists once. Message text is
byte-identical to before (verified by the differential probe described under A-6).

### A-6 — `src/cli/commands/theme.ts` mixes the Windows Terminal apply engine with command printers, and will not survive Phase 4

**Evidence:** `src/cli/commands/theme.ts` is 163 lines holding both the printers
(`runThemeList:13`, `runThemePreview:29`, `runThemeApply:155`) and the backup→merge→write→
verify→rollback engine (`applyThemeFileOnly:66`, `applyThemeToWindowsTerminal:127`), which is
the only consumer of `src/adapters/windows-terminal/apply.ts` and of `src/backup/manager.ts`'s
rollback path.

**Impact:** Wave C (C2) adds `theme validate|create|remove` to this same file, and Wave X adds
a contrast helper that `theme` commands consume. The file goes past ~300 lines of mixed
adapter orchestration and presentation, and `src/cli/interactive/home.ts:7` plus
`src/cli/commands/profile.ts:12` already import the engine *through the command module* — a
command file is load-bearing infrastructure for two other callers.

**Recommendation:** move `applyThemeFileOnly`/`applyThemeToWindowsTerminal` to
`src/core/themes/apply.ts` before C2 lands; leave the printers in `commands/theme.ts`. This is
a move, not a redesign — the functions are already pure-ish and return result objects.

**Fixed in Wave C-prep.** `applyThemeFileOnly`, `applyThemeToWindowsTerminal`, `ApplyResult`
and the shared `recordActiveState` now live in `src/core/themes/apply.ts`; no printing moved,
so invariant 7 still holds. `src/cli/commands/theme.ts` dropped from 163 to 117 lines and is
printers only. The single engine importer (`src/cli/commands/profile.ts`) was repointed - no
re-export shim, because a shim would have left a command module as the engine's import
surface, which was the finding itself. Behaviour preservation was proved by a differential
probe over seven engine paths (both rollback paths included) whose output was identical before
and after except for the module name, plus a new permanent test at
`tests/integration/theme-apply-engine.test.ts` - the theme apply path had no direct test
before this.

### A-7 — A mistyped command reports "too many arguments" instead of "unknown command"

**Evidence:** `src/index.ts:87-89` registers a default `program.action()`. Because the program
then has an action handler and no declared arguments, Commander treats a stray positional as
excess rather than as an unmatched subcommand:

```
$ node dist/index.js nosuchcommand
error: too many arguments. Expected 0 arguments but got 1.   (exit 1)
```

Sub-level typos are fine (`theme nosub` → `error: unknown command 'nosub'`), so the failure is
specific to the top level, which is where typos actually happen.

**Impact:** the most common user error produces a message that describes an argument-count
problem the user did not have. Exit code is already correct (1).

**Fixed in A2** — the default action now rejects a stray positional with
`error: unknown command '<x>'`, still exit 1.

---

## Low

### A-8 — Redundant `isInitialized() ? readConfig() : null` guard, duplicated four times

**Evidence:** `src/cli/commands/status.ts:12`, `src/cli/commands/theme.ts:15`,
`src/cli/commands/profile.ts:21`, `src/cli/commands/profile.ts:52`.

**Impact:** `readConfig()` already returns `defaultConfig` when the file does not exist
(`src/core/config/store.ts:31-33`), so the guard is dead weight at every call site, and it
teaches the next author that `readConfig()` is unsafe to call unguarded — which, before A-2
was fixed, was true for the wrong reason.

**Fixed in A2** in `status.ts` and `profile.ts`; **`theme.ts:17` fixed in Wave C-prep**, which
also made `theme list` degrade rather than throw on a corrupt config, matching `status` and
`profile list`.

### A-9 — `process.exitCode` is sticky across an interactive session

**Evidence:** `src/cli/interactive/home.ts:40-54` loops over menu sections calling the same
`run*` functions as Commander; those set `process.exitCode = 1` on failure
(e.g. `src/cli/commands/theme.ts:161` reached from `home.ts:128`). Nothing resets it.

**Impact:** one failed action anywhere in an interactive session makes the whole session exit
1, even if the user then succeeds at something else and exits the menu normally.

**Not fixed.** `home.ts` is outside this agent's territory, and "what should an interactive
session's exit code mean?" is a product question, not a structural defect — a session is not a
scripted invocation. Flagged for devex-ux-agent / planner-architect.

### A-10 — `removeProfile` deletes the file before it reads the config it may need to update

**Evidence:** `src/core/profiles/manager.ts:131-137` — `fs.unlinkSync(filePath)` then
`readConfig()` then conditional `writeConfig`.

**Impact:** with a corrupt `config.json`, the profile file is already gone when `readConfig()`
throws, so the command reports failure for an operation that half-happened. (A2 turns the
stack trace into a readable exit-2 message; the ordering is unchanged.)

**Not fixed.** `src/core/profiles/manager.ts` is outside this agent's territory and was edited
by security-agent in Wave A. The fix is to read the config before the unlink.

### A-11 — `runRestore` hand-rolls its own catch-and-print

**Evidence:** `src/cli/commands/backup.ts:38-46` — the only command with a `try`/`catch` whose
whole body is `console.error(chalk.red(message)); process.exitCode = 1`.

**Impact:** once a top-level handler exists this is a second, divergent copy of it. It is also
the thing A2's brief calls out: commands should propagate rather than each invent their own
printing.

**Fixed in A2** — the `try`/`catch` is deleted; `restoreBackup`'s error reaches the top-level
handler and produces identical output and exit code.

**Revised in Wave C-prep.** Devex-ux-agent's F6 finding is that `restore` left the user with no
next step. A `try`/`catch` is back, but it no longer prints: it attaches a hint to a
`NightshiftError` and rethrows, so the top-level handler is still the only place that renders a
failure and sets the exit code. Catching to add context and rethrow is not what A-11 was
about; catching to print is.

---

## REQUIRED — things that look like problems and are deliberate

Flagging any of these as a defect is a **false positive**. Each is a recorded decision in
`docs/ARCHITECTURE.md` or verified clean during this audit.

1. **No `Adapter` interface for one adapter.** `src/adapters/windows-terminal/` is the only
   adapter. `docs/ARCHITECTURE.md` → "What's deliberately NOT abstracted yet": the interface
   arrives with the second real implementation, not before. Invariant 6.
2. **No plugin/extension loader.** Themes, profiles, banners and (planned) widgets are JSON
   data, not code, by design — `docs/ARCHITECTURE.md` and `docs/SECURITY-MODEL.md`.
3. **`src/backup/manager.ts` is not Windows-Terminal-specific.** It snapshots any path with
   metadata. That generality is deliberate so a future adapter reuses it; it is not
   speculative abstraction, it is one concrete implementation with a narrow signature.
4. **`path.resolve(process.cwd(), sourcePath)` in `src/core/profiles/manager.ts:23` and `:103`
   does not go through `src/security/paths.ts`, and must not.** `resolveSafePath` confines a
   name *inside a NIGHTSHIFT-owned directory*; `profile import <file>` / `export --output
   <path>` are explicitly the user naming an arbitrary location in their own filesystem.
   Confining them would break the feature. The write side is guarded by `assertNotSymlink`
   (`manager.ts:79,113`). Invariant 3 is about names that become paths *inside* NIGHTSHIFT's
   directories — every one of those does route through `resolveSafePath`
   (`backup/manager.ts:25,65`, `themes/registry.ts:21`, `profiles/registry.ts:27,73,91`,
   `profiles/manager.ts:69,130`).
5. **`path.join` inside `src/core/config/paths.ts` and `src/utils/atomicWrite.ts`** joins only
   constants and already-validated directories. It is not user input.
6. **Commands set `process.exitCode` instead of calling `process.exit()`.** Deliberate:
   `process.exit()` truncates buffered stdout, which for a CLI whose output is tables is a
   real data-loss bug. A2's handler follows the same rule.
7. **Registries re-read from disk on every call** (`getTheme` → `loadUserThemes`,
   `getProfile` → `listProfiles`). No cache, by design: every command is a one-shot `node`
   invocation (invariant 5), so a cache would have nothing to amortise over. The *startup*
   cost that does matter is tracked separately as G18 and owned by performance-agent.
8. **`src/core/` does not print.** Verified, not assumed:
   `grep -rn "console\.(log|error|warn)" src/core src/adapters src/backup src/security src/utils`
   → no matches. Invariant 7 holds. `inspectUserProfilesDirectory()`
   (`profiles/registry.ts:84`) is the pattern to copy: core *returns* the diagnostic, `doctor`
   prints it.
9. **Rendering libraries are confined to `src/cli/ui/`.** Verified:
   `grep -rn "cli-table3|boxen|@clack/prompts" src/ --include=*.ts` outside `src/cli/ui/`
   returns one hit, a prose comment at `src/banners/startup.ts:18`. Invariant 2 holds.
   `chalk` is *not* in that set and is used directly across command modules by design.
10. **`src/index.ts` is a flat 91-line list of `program.command(...)` calls with no grouping
    helper.** That is what wiring-only looks like; a `registerCommands()` abstraction over a
    single call site would hide the only thing the file is for. It grows linearly with the
    command set and that is acceptable.
11. **`src/cli/interactive/home.ts` calls the same `run*` functions as Commander** rather than
    reimplementing anything (`home.ts:7-17`). This is invariant 1 working. The duplication
    worth worrying about is A-5, which is between two *command* modules.

---

## Already tracked elsewhere — not re-derived here

`IMPLEMENTATION_PLAN.md` §1.3 already owns these with evidence; re-filing them would be noise:
G7 (unvalidated `settings.json` casts) and G8 (`table.ts` width maths) → debugging-agent;
G9 (read limits) → **closed by Wave A**, `src/security/limits.ts`; G13–G15 (contrast,
`NO_COLOR`, error components) → devex-ux-agent; G16/G17 (coverage, missing tests) →
qa-testing-agent; G18 (eager imports at `src/index.ts:2-17`) → performance-agent;
G19/G20–G24 (packaging, CI) → dependency-compat-agent and build-release-agent.

---

## Handed-over follow-ups closed in Wave C-prep

Not A-findings — these came from devex-ux-agent's `UX_AUDIT.md` and could not be fixed there
because they needed files it did not own. Recorded here so the trail is complete.

| Item | What was wrong | Fix |
|---|---|---|
| `--no-color` registration | `src/cli/ui/color-mode.ts` spliced the flag out of `process.argv` because Commander rejects unregistered options, so the flag worked but was invisible in `--help` — and the splice depended on every command module being imported at `src/index.ts` module scope, which the planned lazy-import work (G18) would have broken. | `.option("--no-color", ...)` registered on the root program; the splice deleted. Verified that Commander 13 resolves a root option appearing after a subcommand against the parent, so one registration covers `nightshift --no-color status` and `nightshift theme list --no-color` alike. |
| F6 — dead-end failures | `profile import/export/remove/apply`, `profile show`, `restore`, and `backup create` printed a bare `chalk.red` line with no next step. | All now use `feedback.ts` (`failWith`/`successMessage`/`emptyState`/`warnMessage`) with a concrete `→ hint`. `reportFatal` renders through `errorMessage()` too, so escaped throws get the same shape. |
| `init` ignored colour settings | `src/cli/commands/init.ts` imported no `src/cli/ui/` module, so the `color-mode.ts` import side effect never ran for it and `NO_COLOR` did not reach it. | Imports `feedback.ts`, which pulls in `color-mode.ts`, and uses its glyph-bearing components. |
| F7 — mixed path separators | `locateClaudeCodeSettings()` in `src/core/capabilities/detect.ts:21` built `` `${os.homedir()}/.claude/settings.json` `` by concatenation, printing `C:\Users\Amar/.claude/settings.json` in `doctor` and `status`. | `path.join`. Regression-tested in `tests/integration/error-handling.test.ts`. |
