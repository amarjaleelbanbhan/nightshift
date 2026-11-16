# Independent code review - main + five open PRs (Nov 16, 2026)

Reviewer: independent agent, no authorship of the reviewed code. Review-only: no source files
were edited in the reviewed repository. Gate commands were run by the reviewer, not taken from
any prior report.

## Scope and method

Reviewed `main` (`origin/main` @ `7f02cfc`) plus the five open PR branches, each exactly one
commit on top of its own merge-base with `main`:

| Branch | Commit | Merge-base with main |
|---|---|---|
| `feat/font-install` (#15) | `fbcfa98` | `7f02cfc` (current main tip) |
| `feat/theme-edit` (#40) | `8611e2c` | `11a9db1` (one PR behind main tip) |
| `feat/shell-integration` (#16) | `0334532` | `7f02cfc` (current main tip) |
| `fix/claude-code-appearance-rebase` (#18) | `705ac64` | `11a9db1` (one PR behind main tip) |
| `fix/npm-package-name` (#39) | `3a3ea0d` | `7adf4cc` (two PRs behind main tip) |

**Methodology note, because it matters for how to read the gate output below.** The assigned
worktree is shared infrastructure: partway through this review its checked-out branch and HEAD
changed underneath the reviewer, with uncommitted edits in progress (a duplicate `font.js`
import in `src/cli/interactive/home.ts` and a broken JSDoc comment in `src/security/limits.ts`,
mid-fix). To get results unaffected by that, the first full gate run and all five single-PR
diffs were done in an isolated clone, not shared with any other process. By the time the review
returned to the assigned worktree, the concurrent process had finished and committed `497ec8d`
- an actual merge of all five PR branches into this worktree's branch. The gate was then
re-run a second time, directly on that real commit, in the worktree itself, and that is the
output reported below. Both runs agree.

Independently, before seeing `497ec8d`, the reviewer merged the same five branches in the
isolated clone to check whether they integrate cleanly. They do not, mechanically - see
Finding 3. The fix needed is exactly what `497ec8d` contains, which is independent
confirmation the hazard is real rather than a fixture of the reviewer's own merge.

## Gate output (real, commit `497ec8d` - main + all 5 PRs merged)

```
$ npm run format:check
All matched files use Prettier code style!

$ npm run typecheck
(clean - tsc -p tsconfig.json --noEmit, no output, exit 0)

$ npm run lint
(clean - eslint src tests, no output, exit 0)

$ npm run build
(clean - tsc -p tsconfig.json, no output, exit 0)

$ npm test
 Test Files  36 passed (36)
      Tests  569 passed (569)

$ npm run test:coverage
Statements   : 70.99% ( 1371/1931 )
Branches     : 65.58% (  787/1200 )
Functions    : 67.70% (  239/353  )
Lines        : 72.16% ( 1242/1721 )
(coverage thresholds in vitest.config.ts are the real gate here - both the global tripwire and
 the 92/85/94/95 engine floor over src/{core,adapters,backup,security,utils} - and both pass;
 exit 0)

$ npm audit
found 0 vulnerabilities
```

Also run, individually, on `origin/main` alone before any PR was applied: identical result
shape (462 tests / 33 files on main alone, same four gate stages clean, `npm audit` 0
vulnerabilities). **The gate passes, cleanly, on main and on the merged state. No blocking gate
failure exists at either point.**

## Blocking findings

**None.** No security defect, no architectural-invariant violation, and no gate failure was
found in `main` or in any of the five PR branches, individually or combined.

## Advisory findings

### 1. A failure message claims a restore that did not happen (shell integration)

`src/cli/commands/shell.ts:233` and `src/core/shell/integrate.ts:457-469`.

`executeShellIntegration()` has two distinct failure exits. If `createBackup()` itself throws
(`integrate.ts:461-469`, e.g. the backups directory can't be created, or the disk is full when
`metadata.json` is written), the function returns before ever touching `$PROFILE` - nothing was
backed up and nothing was written. If the *write* then fails after a successful backup
(`integrate.ts:483-500`), the real rollback path runs: `restoreBackup()` or `fs.rmSync` on a
newly-created file.

Both of these distinct outcomes are reported through the *same* call site,
`runShellEdit` to `failWith(result.message, "Your profile was restored from the backup taken in
step 1. nightshift backup list shows it.")` (`shell.ts:230-234`). For the first outcome -
backup creation itself failing - this hint is false: step 1 is exactly what failed, there is no
backup, and `nightshift backup list` will not show one. The profile is in fact untouched (no
data loss), but the message tells the user an action occurred that did not.

**Concrete trigger:** run `nightshift shell init --yes` in an environment where
`%APPDATA%\nightshift\backups` cannot be created or written (e.g. a read-only `%APPDATA%`, or a
full disk at exactly the `metadata.json` write). `createBackup()` throws inside
`executeShellIntegration()`'s first `try` block; the printed failure claims "Your profile was
restored from the backup taken in step 1," which never existed.

This is the same category of claim the project's own stated rule exists to prevent (never
report an action as having happened when it did not) - just surfacing on the rollback-narration
side rather than the write-success side. Low impact (no data is lost either way) but a real,
reproducible false statement in user-facing output. Fix would be to vary the hint on which of
the two `integrate.ts` failure messages came back, not to change the control flow.

### 2. `theme edit`'s write is not literally `createTheme`'s write, despite the claim

`src/core/themes/manager.ts:192-194` (`createTheme`) vs. `src/core/themes/manager.ts:346-347`
(`editTheme`).

The PR's commit message states: "The write is createTheme's write - same safe-path
resolution, same symlink guard, same atomic write - so there is still exactly one theme writer
in the codebase." Reading both functions: `editTheme` does not call `createTheme`. It
independently repeats the identical three-line sequence -
`resolveSafePath` then `assertNotSymlink` then `atomicWriteFileSync(destPath,
JSON.stringify(theme, null, 2))` - rather than factoring it into one function both call. The
*primitives* are shared (as they are everywhere else in the codebase); the *write path itself*
is two copies, not one.

This matches the exact hazard `docs/ARCHITECTURE.md` names for `recordActiveState` ("theme apply
and profile apply were two copies of this same sequence; a fix applied to one copy and not the
other was the real hazard, not the duplication") - and there is already a concrete asymmetry
between the two copies: `createTheme` calls `fs.mkdirSync(destDir, { recursive: true })`
immediately before its write (`manager.ts:191`); `editTheme` does not. This is harmless *today*
only because `editTheme` is only reachable once `userThemeFileExists()` has already confirmed
the directory exists (`manager.ts:267`) - but that is a property of the caller, not of the
write function, and the next person who touches `createTheme`'s write (as `theme edit`'s own
commit message invites a reader to assume already happens for both) will not get the change in
`editTheme` for free.

Advisory, not blocking: no current behavioral bug, and the two call sites are three lines each
and easy to audit together today. Worth a follow-up extracting one `writeThemeFile()` helper
before a third caller (e.g. a future `theme import`) makes it three copies.

### 3. Merging `feat/font-install` and `feat/shell-integration` hits two conflicts whose obvious resolution breaks the build

Confirmed by direct reproduction, not inference. Both branches add an import line to
`src/cli/interactive/home.ts`'s existing `from "../commands/font.js"` import, and both branches
add a new byte-size constant to the same JSDoc-commented block in `src/security/limits.ts`.
Merging the two branches with `git merge` leaves real conflicts in exactly those two spots, and
the textually obvious resolution - keep both sides - produces, respectively: a duplicate
`import { runFontList, runFontCheck }` / `import { runFontList, runFontCheck, runFontInstall }`
pair from the same module (a TypeScript duplicate-identifier error) and an unterminated
`/** ... */` block followed by a second comment body with no opening `/**` (a Prettier/parse
error). Both are confirmed compile/format failures, reproduced in an isolated sandbox merge.

This is not a defect in either PR individually - each branch alone typechecks, lints, builds
and tests cleanly (see per-branch notes below) - and the actual integration commit in this
worktree (`497ec8d`) already resolves both correctly (verified: the import line is deduplicated
and the second JSDoc block has its own `/**`). It is recorded here because it is exactly the
kind of cross-branch collision an independent, combined review exists to catch, and because
during this review a different automated process in this same environment was observed
resolving these exact two conflicts live - independent, unprompted confirmation that the hazard
is real in practice, not a reviewer-constructed scenario.

## Architectural invariants (`docs/ARCHITECTURE.md`, `docs/SECURITY-MODEL.md`)

All checked by grep across all of `src/`, on `main` and on the five-branch merge:

- **No `console.*` under `src/core/`, `src/adapters/`, `src/backup/`, `src/security/`,
  `src/utils/`.** Confirmed - zero matches.
- **No child-process execution, no network call anywhere in `src/`.** Confirmed - zero matches
  for `child_process`, `exec(`, `spawn(`, `fetch(`, `http(s).request`. `feat/font-install` and
  `feat/shell-integration` - the two branches most likely to need one - both explicitly avoid it
  by design (PATH/registry-shape scanning with `fs`, never running `reg.exe` or `starship`) and
  say so in their own module docs.
- **`cli-table3`, `boxen`, `@clack/prompts` confined to `src/cli/ui/`.** Confirmed as the
  architecture doc actually states it. Note: the doc's own sentence names only these three
  libraries, not `chalk` - `chalk` is used pervasively across `src/cli/commands/*.ts`,
  `src/cli/interactive/home.ts`, `src/banners/`, and `src/index.ts` by existing, pre-PR design
  (simple inline color codes, not a second UI layer). The task brief's framing of "no rendering
  library... outside `src/cli/ui/`" including `chalk` is broader than the project's own stated
  rule; against the project's own rule as written, there is no violation, and none of the five
  PRs changes this pattern.
- **`src/index.ts` stays wiring-only.** Confirmed for all three branches that touch it
  (`font-install`, `theme-edit`, `shell-integration`): each adds only `.command()` /
  `.option()` / `.action(async (...) => (await xModule()).runX(...))` registrations, no
  conditionals, no `fs`, no formatting.
- **No `path.join` on user input bypassing `src/security/paths.ts`.** Confirmed. Every new
  `path.join` call in the five branches joins fixed segments or already-validated basenames
  (e.g. `src/core/fonts/install.ts`'s `fontFilesIn()` joins a directory with `readdirSync`
  output, not user text); every destination actually derived from user-controlled text
  (`font install <path>`'s destination, `theme edit`'s theme file, `shell init`'s profile path)
  goes through `resolveSafePath`.
- **No duplicate implementation** of the contrast helper, the JSON size guard, or the
  backup/rollback sequence: `feat/theme-edit` reuses `auditThemeContrast` and `safeParseTheme`
  (not a second contrast or validation routine); `feat/font-install` and
  `feat/shell-integration` both add their own named size constant in `security/limits.ts`
  (`MAX_FONT_FILE_BYTES`, `MAX_SHELL_PROFILE_BYTES`) but both route through the one
  `readJsonFileWithLimit`/explicit-`stat` pattern already established, not a second guard
  mechanism; `feat/shell-integration` reuses `createBackup`/`restoreBackup` from
  `backup/manager.ts` rather than writing its own snapshot code. **The one place the "exactly
  one writer" claim does not hold literally is `theme edit` vs. `theme create`** - Finding 2
  above.
- **`font install` reuses the existing font detector.** Confirmed:
  `verifyFontFamilies()` in `src/core/fonts/install.ts:234-239` calls the same
  `findInstalledFont` that `font check`/`font list` use; there is no second detector.

## Honesty audit

- **`font install`'s registry-write gap is stated everywhere a user would meet it**, and
  consistently: the module doc in `src/core/fonts/install.ts`, the proposal and the post-write
  result in `src/cli/commands/font.ts` (`REGISTRATION_LIMITATION`, printed before approval and
  again after the copy, with the exact `reg add` command), `README.md`'s feature line and
  "Known limitations" section, `ROADMAP_STATUS.md`'s Phase 3 section, and
  `docs/SECURITY-MODEL.md`. Confirmed consistent across all five locations.
- **Exit code for a failed/partial font install is `1`** via `failWith()` to
  `process.exitCode = 1` (`src/cli/ui/feedback.ts:41`), matching the documented exit-code
  contract (`1` = runtime/usage failure). Defensible: a copy that the detector cannot verify
  afterward is treated as a failure, not a success with a footnote, which is what the contract
  calls for.
- **`theme edit` keeps contrast advisory**, exactly as `theme validate` already does: a
  failing WCAG ratio is printed but the write still happens (`manager.ts`'s `editTheme` never
  sets `ok: false` for a contrast failure, only for a schema failure). Confirmed consistent,
  no drift from the existing rule.
- **`doctor`'s new Claude Code appearance check never fails the command** - it only ever
  returns `status: "ok"` or `status: "warn"` (`src/cli/commands/doctor.ts`'s
  `claudeCodeAppearanceCheck`), matching the documented rule that `doctor` exits non-zero only
  for a `fail` check. Confirmed.
- **The previously-identified `package.json` "widgets" claim is fixed, but only in the PR, not
  yet in `main`.** `fix/npm-package-name` changes the `description` field to drop "widgets"
  (`package.json:3-4` in that branch); `main`'s own `package.json` still carries the old wording
  until that PR merges. Not a new finding - flagged only so it isn't mistaken for already
  resolved on `main`.

## Test integrity (git log -p -- tests/)

The two tests in `tests/unit/wt-settings-shapes.test.ts` that the task brief flagged as
"deliberately replaced" were checked directly (commit `0741d13`, already on `main`, inherited by
all five PR branches - not part of any of the five PRs themselves). Judgment: **legitimate
replacement, not a weakening.** The removed tests asserted that a `//`-commented
`settings.json` is *refused* - behavior the same commit intentionally changes (JSONC is now
read and edited in place rather than refused). The replacement tests cover equal or greater
ground: a `//`-header file now parses, a `/* */`-plus-trailing-comma file parses, a *truncated*
file is still correctly rejected (with a line number), and two cases the old suite did not cover
at all are added - a pathologically nested file (stack-overflow guard) and a plain syntax error
naming its remedy. No assertion was loosened; the one removed test case (URL-vs-comment
confusion) is moot under the new implementation, which parses with a real JSONC parser rather
than regex comment-stripping, so the risk that test guarded against no longer exists in the same
form.

No other test weakening, skip, or deletion was found across the five PRs' own test additions
(`interactive-home.test.ts`, `theme-manager.test.ts`, `claude-code-integration.test.ts`,
`shell-integration.test.ts`, `font-install.test.ts`) - all are additions.

## Completion claims - `docs/development/IMPLEMENTATION_PLAN.md`

- **Refuted:** the document's own header (`IMPLEMENTATION_PLAN.md:6`) claims "Status: live -
  updated as tasks complete." Waves 6 through 14 (`IMPLEMENTATION_PLAN.md:351-471`) - the
  error/exit-code contract (A2), `NO_COLOR`/contrast (X2), `nightshift setup` (C1),
  `theme validate/create/remove` (C2), font detection (F2), lazy command-module loading (E2),
  the coverage threshold (Q2), the release checklist (B2), and the independent-review /
  documentation / integration / acceptance waves (R2, W2, I1, I2, P2) - are **every one** still
  marked `Not started`, test result `-`. This does not match the repository: `src/cli/errors.ts`
  contains exactly the three exit constants A2 describes (`EXIT_SUCCESS`/`EXIT_FAILURE`/
  `EXIT_CONFIG_CORRUPT`, `errors.ts:19-21`); `src/cli/ui/color-mode.ts` exists; `src/cli/commands/
  setup.ts` exists; `theme validate|create|remove` exist in `src/cli/commands/theme.ts`;
  `src/index.ts` already does the lazy `const fontModule = () => import(...)` pattern E2
  describes; `vitest.config.ts` already has the exact split global/engine coverage thresholds Q2
  describes; `docs/development/RELEASE_CHECKLIST.md` (B2's deliverable) exists. The tracker is
  stale relative to the shipped state it claims to track live - a documentation-accuracy gap,
  not a functional one, but one that would actively mislead a contributor who trusts the "live"
  claim at face value.
- **Confirmed:** Wave 5 / S2 ("Zod 3 to 4 upgrade + dev advisories... before/after npm audit
  pasted... 85/85 tests pass... full gate passes," `IMPLEMENTATION_PLAN.md:309`). This matches:
  `package.json` has `zod: ^4.6.7`; `docs/SECURITY-MODEL.md` documents the same 10 to 0
  `npm audit` finding count this review's own `npm audit` run reproduces (0 vulnerabilities);
  the `@typescript-eslint/typescript-estree` to `minimatch` override in `package.json` matches
  the documented remediation. Confirmed as claimed.
- **Confirmed (deliverables present, commit hash not independently re-verified):** Wave 3.0.1's
  claim that "Waves A, B, C-prep, C, D, G, H all completed and were merged to main as
  `026d35d`" (`IMPLEMENTATION_PLAN.md:225`) - every deliverable the row describes for those
  waves (error contract, UX system, core CLI features, font detection, etc.) is present and
  working in the current `main`, which is consistent with the claim. The specific commit hash
  `026d35d` was not walked in `main`'s history as part of this review; the claim is accepted on
  the strength of the deliverables actually being present, not independently re-traced to that
  exact SHA.

## Per-branch summary

- **`feat/font-install` (#15):** No blocking issues. Reuses `findInstalledFont` for
  verification, no second detector; proposal/execute split with the same TTY guard and `--yes`
  semantics as `setup`; registration gap stated consistently everywhere (see Honesty audit).
- **`feat/theme-edit` (#40):** No blocking issues. One advisory finding (write-path duplication,
  Finding 2 above). Contrast stays advisory, consistent with `theme validate`.
- **`feat/shell-integration` (#16):** No blocking issues. The highest-blast-radius change in the
  product is also the most carefully built: plan/execute split, verbatim-slice editing so
  everything outside the managed block provably survives, post-write verification by re-reading
  the file and re-scanning for the block, and backup-then-rollback on any write failure. One
  advisory finding (misleading rollback hint on a specific failure path, Finding 1 above).
- **`fix/claude-code-appearance-rebase` (#18):** No findings. Read-only, single new schema key,
  `warn`-only exit behavior, reuses existing luminance math and the existing
  `activeThemeOrReason` helper.
- **`fix/npm-package-name` (#39):** No findings. Confirmed fix for the package-description
  "widgets" claim; binary name (`nightshift`) unchanged.

---

## Disposition of the findings (added after the review, by the implementer)

The reviewer was correctly instructed not to implement fixes. This section records what was
done about each finding, so the document is a closed loop rather than a list of open claims.

### Advisory 1 — a false claim in a shell-integration failure message: **FIXED**

Upheld, and treated as more than advisory. `shell init`/`shell remove` printed
*"Your profile was restored from the backup taken in step 1"* on **every** failure, including
three paths where that was untrue: when the plan never ran, when creating the backup was itself
what failed, and — worst — when the rollback was attempted, threw, and was swallowed. The
engine's own message said "and restored it" on that last path too.

This is the one command in the product whose bad day leaves someone without a working shell, so
a reassuring sentence that is not true is worse output than no hint at all. That makes it an
instance of the defect class this project exists to prevent, not a wording nit.

Fixed by making the engine record what it actually did rather than what it set out to do:
`ShellIntegrationResult.recovery` is now `"none" | "restored" | "removed" | "failed"`, the
engine's message is derived from it, and the CLI selects its next-step hint from it. The
`failed` arm is deliberately loud (`AND COULD NOT UNDO THE CHANGE`) and tells the user how to
clean the markers out by hand or restore from a backup id.

Three regression tests were added under "what it claims about recovery", because the original
bug was **untested** — the suite went green with the false claim in place. Verified meaningful
by mutation: reverting the swallowed-rollback arm to report `"restored"` fails the test, and
reverting the mutation returns the suite to green.

### Advisory 2 — `theme edit` duplicating `theme create`'s write: **FIXED**

Upheld. The two shared a copied three-line sequence (symlink check, mkdir, atomic write of
`JSON.stringify(theme, null, 2)`), which contradicted the claim made in PR #43 that there is
exactly one theme writer. Nothing was wrong with either copy, which is the point: the next
change to how this project writes a theme would have landed in one and not the other.

Extracted to one private `writeUserThemeFile(theme)`, plus a `userThemePath(id)` helper, both
called by `createTheme` and `editTheme`. Same reasoning that put the backup/rollback sequence
into a single `recordActiveState` (A-5).

### Advisory 3 — the five branches cannot be merged with a naive resolution: **FIXED**

Upheld and independently reproduced. `src/security/limits.ts` lost the opening of a doc comment
where two branches added a constant in the same place (a syntax error), and
`src/cli/interactive/home.ts` imported `runFontList`/`runFontCheck` twice from the same module.

Both are fixed on `release/0.5.0`, which merges all five branches, resolves the conflicts, and
is the first branch on which the **combined** state was gated: 569 tests across 36 files,
coverage thresholds met, `npm audit` clean, plus an end-to-end run of
`theme apply → theme create → theme edit → shell status → font list`.

That merge also found a third problem the reviewer did not see, because it is editorial rather
than mechanical: README's status section had been merged keeping both sides, leaving it
asserting *"Claude Code integration: detection only. No settings are read or written"* a few
lines below the entry describing the setting NIGHTSHIFT now reads, and *"Font management:
detection only… it does not install"* below the copy-only install. The region was rebuilt.

### Stale completion claims in `IMPLEMENTATION_PLAN.md`: **ANNOTATED, not back-filled**

Upheld. Waves 6–14 still read `Not started` for shipped, tested work.

Deliberately **not** fixed by marking rows `Done`. Those rows were never re-verified one by
one, and back-filling a hundred completion marks from memory would replace a *visibly* stale
document with a *plausibly* wrong one — the worse failure for a project whose rule is that
nothing is claimed without evidence. Instead the document now opens with a warning that its
Status column is stale, and a table pointing at the sources that are maintained
(`ROADMAP_STATUS.md`, `CHANGELOG.md`, the issue tracker, and `npm test`). Its task
decomposition, dependency ordering and acceptance criteria remain useful and are unaffected.

### On the reviewer's methodology note

The concurrency the reviewer hit was real and was caused by this implementer merging the five
branches in the same worktree while the review was running. The reviewer handled it correctly
by moving to an isolated clone and then re-running the gate against the real commit. Recorded
here as a process lesson: a review and a merge should not share a working tree.

### One limit of the fix to Advisory 1, stated plainly

The `recovery` field and the engine's message are covered by tests. The CLI's mapping from
`recovery` to its four hint strings is a pure `switch` with no test of its own, because
provoking a backup failure through the built binary is not something the suite can currently
arrange. The mapping is four lines driven entirely by the tested field; that is a reasoned
stopping point, not an oversight, and it is written down here so the next person can decide
differently.
