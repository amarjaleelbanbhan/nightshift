# NIGHTSHIFT — Implementation Plan and Task Tracker

Owner: `planner-architect` (see `.claude/agents/planner-architect.md`)
Branch: `feat/nightshift-1.0.0`
Created: 2026-11-15
Status: **live** — updated as tasks complete. Nothing is marked Done without a recorded test
result.

> This document complements, not replaces, `ROADMAP_STATUS.md`. `ROADMAP_STATUS.md` is the
> phase truth table for the 1.0.0 product roadmap. This document is the engineering execution
> plan for the current development cycle: who does what, in what order, and what proves it.

---

## 1. Current-state assessment

### 1.1 Verified baseline

Measured on `feat/nightshift-1.0.0` at commit `813c7c9` before any change in this cycle:

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass |
| Lint | `npm run lint` | pass |
| Build | `npm run build` | pass |
| Tests | `npm test` | **73/73 pass**, 12 files, 12.98 s |
| Audit | `npm audit` | **10 findings** (7 moderate, 1 high, 2 critical) |

Code size: ~2,925 lines across `src/` (23 files) and `tests/` (12 files).

### 1.2 What actually works

Confirmed by the passing integration suite, which drives the real built binary
(`node dist/index.js`) and asserts on stdout and exit codes:

- Theme engine — 4 built-in themes, Zod-validated schema, `theme list|preview`.
- `theme apply` — backup → merge → write → verify → rollback against Windows Terminal
  `settings.json`, preserving unrelated keys (`src/adapters/windows-terminal/apply.ts`).
- Profile Manager — `profile list|show|apply|import|export|remove`, reusing the theme engine's
  apply path rather than duplicating it (`src/core/profiles/manager.ts`).
- Backup/restore — generic file-snapshot engine, not Windows-Terminal-specific
  (`src/backup/manager.ts`).
- Capability detection — `doctor`, `status`, reporting
  `supported`/`partial`/`unsupported`/`unknown` from what is actually on disk.
- Interactive home menu with a non-TTY guard (a real, previously-fixed hang).
- Shared width-aware table/panel design system (`src/cli/ui/`).
- Path-traversal and malformed-import protections, with security tests.

### 1.3 Gaps, defects, and risks found in Phase 1 discovery

Every item below has an owning task in §3. Nothing here is speculative — each cites evidence.

**Security / dependencies**

| # | Finding | Evidence | Severity |
|---|---|---|---|
| G1 | `zod` 3.25.76 carries a **high**-severity advisory (GHSA-mrhx-c7xc-m3w5, memory exhaustion validating oversized constrained collections). It is a **runtime** dependency and is exactly what NIGHTSHIFT uses to validate user-supplied JSON. Fix requires `zod` >= 4.6.6 — a breaking major. | `npm audit` | High |
| G2 | `tinypool` (via `vitest` 3) carries two **critical** prototype-pollution→RCE advisories. devDependency only; fix is `vitest` 5 (breaking). | `npm audit` | Critical (dev-only reach) |
| G3 | `minimatch` (via `@typescript-eslint` 8.19) moderate, transitive, dev-only. | `npm audit` | Moderate |

**Reliability / correctness**

| # | Finding | Evidence | Severity |
|---|---|---|---|
| G4 | No top-level error handler. An unexpected throw surfaces a raw Node stack trace to the user. | `src/index.ts` ends at `await program.parseAsync(...)` with no `try`/`catch` | High |
| G5 | `readConfig()` does `JSON.parse` then `configSchema.parse` with no error handling, so a corrupt or hand-edited `config.json` likely crashes **every** command via G4. | `src/core/config/store.ts:31-37` | High |
| G6 | Exit codes are undocumented and effectively only 0/1. A CLI that scripts call needs a documented contract. | `README.md` has no exit-code section | Medium |
| G7 | `mergeThemeIntoSettings()` casts `settings.schemes` to a typed array without validating elements; `readWindowsTerminalSettings()` casts parsed JSON. Hostile/odd `settings.json` shapes are unprobed. | `src/adapters/windows-terminal/apply.ts:51-55, 90-97` | Medium |
| G8 | `src/cli/ui/table.ts` uses `Math.max(...)` spreads over possibly-empty arrays and computes widths without probing empty rows / zero columns / very narrow `COLUMNS`. | `src/cli/ui/table.ts:18-20, 31-38` | Medium |
| G9 | No resource-exhaustion guard on theme-file or `settings.json` reads. Profile import has a 64 KB cap; nothing else does. | `src/core/themes/registry.ts`, `apply.ts:91` | Medium | **Closed in Wave A** |
| G25 | `mergeThemeIntoSettings()` treats `settings.profiles` as an object, but Windows Terminal's legacy form is an **array** — `[{...},{...}]` is mangled into `{"0":...,"1":...}`, destroying the user's profile list. Found during Wave A by hostile-input testing; not in the original discovery. | `src/adapters/windows-terminal/apply.ts:71-74` | **High** — silent destruction of user config |

**Missing features (roadmap phases, achievable subset)**

| # | Finding | Evidence | Phase |
|---|---|---|---|
| G10 | No `nightshift setup`. The interactive menu lists "Setup" as planned. | `src/cli/interactive/home.ts:99,108` | 2 |
| G11 | No way to create or validate a theme. `README.md` tells users to hand-drop JSON into `%APPDATA%\nightshift\themes\`. | `README.md:138` | 4 |
| G12 | No font capability detection, although themes carry `typography.family` and Windows Terminal applies it — a theme requesting a missing font fails silently. | `src/core/themes/schema.ts:46-51` | 3 (read-only subset) |

**CLI UX (all three listed by the repo itself under "Not yet done")**

| # | Finding | Evidence | Severity |
|---|---|---|---|
| G13 | No accessibility/contrast validation of theme colors. | `ROADMAP_STATUS.md:124` | Medium |
| G14 | No `NO_COLOR` / `--no-color` support verified or tested. | `ROADMAP_STATUS.md:126-127` | Medium |
| G15 | No reusable error-panel, confirmation, or empty-state components — plain `chalk.red`/`chalk.gray` lines. | `ROADMAP_STATUS.md:128-129` | Low |

**Testing**

| # | Finding | Evidence | Severity |
|---|---|---|---|
| G16 | No coverage measurement at all, so coverage is unknown and unenforced. | `vitest.config.ts` has no `coverage` block; no provider installed | Medium |
| G17 | No tests for corrupt config, `NO_COLOR`, non-`win32` degradation, or hostile `settings.json`. | `tests/` listing | Medium |

**Performance**

| # | Finding | Evidence | Severity |
|---|---|---|---|
| G18 | `src/index.ts` eagerly imports every command module at module scope, transitively loading `@clack/prompts`, `boxen`, `cli-table3`, `chalk`, and `zod` — so `nightshift --version` loads the whole interactive stack it never uses. Startup cost is the dominant felt performance characteristic of a one-shot CLI. **Measured by the orchestrator: 800 / 843 / 840 / 1277 / 1427 ms for `--version` over 5 runs.** Severity raised Medium → **High** once it was shown to be the root cause of G28. | `src/index.ts:2-17`; direct measurement | **High** |
| G28 | **The test suite was intermittently failing and nobody had noticed**, because the failure is load-dependent. Two integration tests timed out at vitest's 5000 ms default — a *different* pair on each run. Root cause is G18: each `node dist/index.js` spawn costs ~850 ms, so a test making 5+ sequential spawns needs ~4.3 s of pure process startup and tips over under parallel file execution. Found by the orchestrator when a routine post-wave gate run disagreed with the previous one. | `tests/integration/cli.test.ts:119`, `tests/integration/error-handling.test.ts:162`; default `testTimeout` in `vitest.config.ts` | **High** — a flaky suite erodes trust in every other result |

**Build / packaging / compatibility**

| # | Finding | Evidence | Severity |
|---|---|---|---|
| G19 | `package.json` `files` lists `themes` and `schemas`, **neither of which exists** in the repository. | `package.json:10-15`; `ls themes schemas` → no such directory | Medium |
| G20 | CI runs `npm install`, not `npm ci`, so the committed lockfile is not enforced. | `.github/workflows/ci.yml:16` | Medium |
| G21 | CI tests Node 20 only, while `engines` claims `>= 18` — the advertised floor is never tested, and may be false given ESM-only deps and top-level `await`. | `.github/workflows/ci.yml:13`, `package.json:16-18` | Medium |
| G22 | No `prepublishOnly`, so a stale or missing `dist/` could be published. `dist/` is the entire shipped artifact. | `package.json:19-27` | Medium |
| G23 | No `prettier --check` in CI; `npm run format` only *writes*, so unformatted code can land. | `.github/workflows/ci.yml`, `package.json:26` | Low |
| G24 | `src/cli/version.ts` reads the version at runtime — unverified that it resolves correctly from **inside an installed package**. Classic packaging failure mode; never tested. | `src/cli/version.ts` | Medium |

### 1.4 Explicitly out of scope this cycle — with reasons

These are deferred by `ROADMAP_STATUS.md` for reasons that remain valid. Deferring them is a
decision, not an oversight:

| Roadmap phase | Why not now |
|---|---|
| 3 (font **installation**) | Writes into the user's font directory. Requires a shown proposal and explicit human approval. Detection (read-only) **is** in scope as F2. |
| 5 (ASCII Art Studio) | Directly conflicts with the recorded design decision against ASCII-art/retro CLI aesthetics. Needs a human product decision before any build. |
| 6 (shell / Starship integration) | Edits the user's shell startup files. Requires a shown diff and explicit approval. |
| 7 (widget engine) | Depends on a data-only widget format that does not exist yet; no background process is permitted, so widgets must compute on demand — a design task, not an implementation task. |
| 8 (Claude Code integration) | Beyond detection, requires reading/writing `~/.claude/settings.json` — another user-approved write surface. |
| 9 (Linux/macOS adapters) | Cannot be executed or verified on this machine (Windows 11 only). Building untestable adapters would create the exact false-confidence this project's docs exist to prevent. |
| 10 (Studio) | A local React+Vite app with its own HTTP server and security surface. A separate build. |
| 11 (marketplace) | Requires a second real GitHub repository with hosted, hash-verified assets. |
| 12 (additional customization) | Blocked on 3, 6, 7. |

### 1.5 Definition of completion for this cycle

1. `npm run typecheck && npm run lint && npm run build && npm test` green, with more tests than
   the 73-test baseline and measured coverage reported.
2. The high-severity runtime `zod` advisory cleared; remaining `npm audit` findings reported
   honestly with reachability analysis.
3. No command can produce a raw stack trace; exit codes documented and tested.
4. G10, G11, G12 implemented, each exercised by a real command invocation with recorded output.
5. G13–G15 implemented, with contrast numbers for all four built-in themes reported as measured.
6. Packaging proven by installing the packed tarball into a scratch directory and running the
   installed binary.
7. `README.md`, `ROADMAP_STATUS.md`, `CHANGELOG.md` true to the shipped code — verified
   command-by-command.
8. `PROJECT_COMPLETION_REPORT.md` distinguishing completed / tested / partial / unverified.

---

## 2. Orchestration: environment limitation and the mechanism used

**Limitation, stated plainly.** Claude Code loads `.claude/agents/*.md` at session start. The
14 definitions in this cycle were created *during* this session, so they are **not available as
`subagent_type` values here** — dispatch was attempted and failed with
`Agent type 'code-review-agent' not found`. They will be natively dispatchable in any
subsequent session.

**Mechanism used instead.** Each task is dispatched to a `general-purpose` subagent whose
prompt instructs it to first read its own definition file (e.g.
`.claude/agents/security-agent.md`) and operate under that identity, scope, and boundaries.
This is genuine parallel subagent execution with the real persona content — not simulated, and
not a single agent pretending to be many. The only thing lost is the native `subagent_type`
binding.

**Why waves rather than all-at-once.** All agents share **one working tree**. Unbounded
parallelism here does not produce speed, it produces lost edits — two agents editing
`src/index.ts`, or `npm install` running under another agent's `node dist/index.js`. Work is
therefore grouped into waves that are internally **file-disjoint**, and parallelism within each
wave is real and simultaneous. Three deliberate serializations:

- `npm`-mutating tasks run alone (they change `node_modules` under everyone else).
- Performance measurement runs alone (concurrent agents poison the timings).
- `src/index.ts` writers run in sequence, and the lazy-import restructuring (E2) runs **after**
  all command registration is final.

### 2.1 Revision after the first dispatch attempt (recorded, not hidden)

The first attempt dispatched **9 agents simultaneously** (Wave 1's seven audits plus D1 and
B1). All nine terminated on a provider **session rate limit** before producing output. No work
was lost — every one of them was a report-only task that had not yet written its file — but the
plan was wrong and is revised:

1. **Concurrency capped at 2 agents.** Nine concurrent agents on a frontier model is not
   parallelism, it is a self-inflicted outage.
2. **Audit tasks are merged into their paired implementation task** rather than run as separate
   report-only waves. Each agent now executes both of its tasks in one dispatch (audit, then
   implement from its own findings). This is strictly better here: the audit informs the
   implementation inside one context instead of being serialized through a document, and the
   objective is working code rather than eleven audit reports. Phase 1 discovery had already
   produced the evidence-backed gap list in §1.3, so the standalone audits were the
   lowest-value output available.
3. **Review tasks stay separate and independent.** R1/R2 (code review) and I1/I2 (integration)
   must *not* be merged into the work they judge — an agent reviewing its own implementation is
   not a review. These remain late, independent waves.

The revised wave sequence is in §3. Task IDs and acceptance criteria are unchanged; only the
grouping and concurrency changed.

---

## 3. Task tracker

Status values: `Not started` · `In progress` · `Done` (requires recorded test result) ·
`Blocked` · `Deferred`.

### 3.0 Revised wave sequence (supersedes the wave grouping in the tables below)

Per §2.1, each agent now runs both of its tasks in one dispatch, max 2 agents concurrent. The
acceptance criteria in the per-task tables below are unchanged and remain authoritative.

| Wave | Agents (concurrent) | Tasks | Why grouped this way |
|---|---|---|---|
| **A** | security-agent | S1 + S2 | Critical path. Sole writer of `package.json`/lockfile and every Zod schema. Must land before feature work builds on the schemas. Runs alone. |
| **B** | architecture-agent ∥ devex-ux-agent | A1+A2 ∥ X1+X2 | File-disjoint: A2 owns `src/cli/errors.ts` + `src/index.ts` error wiring + `config/store.ts` error paths; X2 owns `src/cli/ui/*` + a new contrast helper + `src/banners/startup.ts`. |
| **C** | core-cli-agent | C1 + C2 | Adds `setup` and `theme validate\|create\|remove`. Sole `src/index.ts` writer this wave. Depends on A2's error contract and X2's components. |
| **D** | feature-agent ∥ debugging-agent | F2 ∥ D1+D2 | F2 owns `src/core/fonts/`, `src/cli/commands/font.ts`, `doctor`; D2 owns `adapters/windows-terminal/apply.ts`, `cli/ui/table.ts`, `tests/`. Disjoint. |
| **E** | performance-agent | E1 + E2 | Must be the **last** `src/index.ts` writer (lazy imports require the final command set). Runs alone — concurrent agents poison timing measurement. |
| **F** | qa-testing-agent | Q1 + Q2 | Adds the coverage provider (mutates `node_modules`) and the bulk of new tests. Runs alone. |
| **G** | dependency-compat-agent | N1 + N2 | `engines` floor, `files` array, lockfile. Second `package.json` writer, after S2. |
| **H** | build-release-agent | B1 + B2 | Needs the tree to itself for the clean `npm ci` rebuild and install-from-tarball test. Third `package.json` writer (scripts only). |
| **I** | code-review-agent ∥ documentation-agent | R1+R2 ∥ W1+W2 | Independent judgment of the finished work. R is review-only (no writes to source); W writes docs. Disjoint. |
| **J** | integration-agent | I1 + I2 | Collision map from the real `git diff`, then combined end-to-end validation. Runs alone. |
| **K** | orchestrator | P2 | Final acceptance + `PROJECT_COMPLETION_REPORT.md` + `ROADMAP_STATUS.md` reconciliation. |

Wave A status: **in progress**.

### Wave 1 — Audits (7 agents, parallel, read-only; write only their own new report)

| ID | Agent | Description | Deps | Acceptance criteria | Status | Test result |
|---|---|---|---|---|---|---|
| A1 | architecture-agent | Architecture audit → `docs/development/ARCHITECTURE_AUDIT.md` | — | Every finding cites file:line; deliberate non-abstractions listed so nobody "fixes" them; no source changed | Not started | — |
| R1 | code-review-agent | Baseline code review → `docs/development/CODE_REVIEW.md` | — | Findings ranked, each with file:line + concrete failure scenario; "must not regress" section included | Not started | — |
| S1 | security-agent | Security audit → `docs/development/SECURITY_AUDIT.md` | — | Every fs/parse call site assessed; runtime vs dev-only advisory reach separated | Not started | — |
| X1 | devex-ux-agent | CLI experience audit → `docs/development/UX_AUDIT.md` | — | Every finding records real command + output + exit code; human-TTY-verification list included | Not started | — |
| F1 | feature-agent | Feature inventory → `docs/development/FEATURE_INVENTORY.md` | — | Every "Implemented" backed by an executed command; every "Missing" names its roadmap phase | Not started | — |
| W1 | documentation-agent | Docs truth audit → `docs/development/DOCS_AUDIT.md` | — | Every README command-table row verified by running it; documented JSON examples schema-validated | Not started | — |
| N1 | dependency-compat-agent | Dependency/engine/compat audit → `docs/development/DEPENDENCY_AUDIT.md` | — | Verified Node floor with named cause; every platform branch classified tested/reasoned/unknown | Not started | — |

### Wave 2 — Dynamic probing (2 agents, parallel)

| ID | Agent | Description | Deps | Acceptance criteria | Status | Test result |
|---|---|---|---|---|---|---|
| D1 | debugging-agent | Bug hunt against isolated `APPDATA` → `docs/development/BUG_REPORT.md` | — | Every finding has a reproduction actually run; defects separated from acceptable behavior | Not started | — |
| B1 | build-release-agent | Build/packaging/release audit → `docs/development/BUILD_RELEASE_AUDIT.md` | — | **Install-from-tarball actually performed** and output reported; G24 resolved either way | Not started | — |

### Wave 3 — Coverage instrumentation (1 agent, mutates `node_modules`)

| ID | Agent | Description | Deps | Acceptance criteria | Status | Test result |
|---|---|---|---|---|---|---|
| Q1 | qa-testing-agent | Add `@vitest/coverage-v8`, measure, write `docs/development/TEST_STRATEGY.md` | — | Real coverage numbers reported; proposed threshold justified against measurement, not aspiration | Not started | — |

### Wave 4 — Performance measurement (1 agent, requires a quiet machine)

| ID | Agent | Description | Deps | Acceptance criteria | Status | Test result |
|---|---|---|---|---|---|---|
| E1 | performance-agent | Measure startup + per-command cost → `docs/development/PERFORMANCE_REPORT.md` | Q1 | Node floor separated from NIGHTSHIFT's marginal cost; min/median over a stated run count; per-dependency import cost | Not started | — |

### Wave 5 — Dependency remediation (1 agent, sole `package.json` writer)

| ID | Agent | Description | Deps | Acceptance criteria | Status | Test result |
|---|---|---|---|---|---|---|
| S2 | security-agent | **Zod 3 → 4 upgrade** + dev advisories (`vitest`, `@typescript-eslint`) + G9 guards + harden G7 casts | S1 | Before/after `npm audit` pasted, high `zod` finding gone; full gate passes; **no security test deleted or weakened** | **Done** | `npm audit` 10 → **0**; `zod@4.6.7`, `vitest@5.1.0`; **85/85 tests pass** (was 73, +12, none removed); typecheck/lint/build clean. **Independently re-verified by the orchestrator.** |

**Wave A outcome (verified, not merely reported).** Orchestrator re-ran `npm ls`, `npm audit`,
typecheck, lint, and the suite: `zod@4.6.7`, `vitest@5.1.0`, 0 vulnerabilities, 85/85 pass.

Notable: the Zod 3→4 migration required **exactly one** API change
(`z.object().strict()` → `z.strictObject()` in `src/core/profiles/schema.ts`), and **zero test
assertions needed updating** because the schema tests assert `result.success` rather than error
shape. New shared `src/security/limits.ts` caps JSON reads at 64 KB by `stat`-ing before
`readFileSync`, and `profiles/manager.ts`'s local `MAX_IMPORT_BYTES` was promoted into it
rather than duplicated (G9 closed).

Two results worth recording because they correct the plan rather than confirm it:

- **G7 was overstated in this plan.** The agent wrote 12 hostile `settings.json` cases
  (`schemes` as null/string/number/object/boolean, elements `[null,"Campbell",42,[],undefined,
  {nested:{}}]`, non-string `name`) and ran them against the **pre-fix** code: all 12 passed.
  The `s?.name` optional chain already handled everything `JSON.parse` can produce. The change
  shipped is therefore **type honesty, not a bug fix** — the `as WindowsTerminalColorScheme[]`
  cast made TypeScript guarantee something false, so a future edit reading `s.background` would
  compile and then crash mid-`theme apply`. Severity corrected Medium → Low, and the 12 cases
  are retained as tests so the crash-safety is asserted instead of accidental.
- **A genuine new defect was found instead**: `src/adapters/windows-terminal/apply.ts:71-74`
  treats `settings.profiles` as an object when Windows Terminal's legacy form is an **array**,
  mangling `[{...},{...}]` into `{"0":...,"1":...}` and destroying the user's profile list.
  Assigned to D2 (Wave D) as it needs an error-path decision. Tracked as **G25**.

`@typescript-eslint` 8.72.2 does **not** clear the `minimatch` advisory on its own, and
`npm audit fix --force` "resolves" it by *downgrading* the parser to 6.15.0. Resolved instead
with a scoped override (`@typescript-eslint/typescript-estree` → `minimatch ^11.0.8`), verified
non-trivially: `npm ls minimatch` confirms 11.0.8 under `typescript-estree`, and a deliberate
`const x: any = 1` probe still raises `@typescript-eslint/no-explicit-any`, proving type-aware
linting still runs. Removable once upstream ships a fix.

Accepted and documented, not fixed: **F-1** `restoreBackup()` writes to an unvalidated
`metadata.originalPath` with no `assertNotSymlink` (needs a `BackupMetadata` Zod schema →
deferred to D2/Q2; no privilege gain, since poisoning that file already requires the user's own
rights); **F-4** the `assertNotSymlink` → `renameSync` TOCTOU window (not closable portably
with sync `fs`, no privilege gain). Windows Terminal's `settings.json` is deliberately left
uncapped — refusing a legitimately large file owned by another application is worse than
reading it.

### Wave 6 — Error contract and UX system (2 agents, parallel, disjoint)

| ID | Agent | Description | Deps | Acceptance criteria | Status | Test result |
|---|---|---|---|---|---|---|
| A2 | architecture-agent | Single error-handling + documented exit-code strategy (G4, G5, G6); approved A1 structural fixes | A1, R1, S2 | Corrupt `config.json` → readable message + documented non-zero code, proven on the real built binary; no stack trace reachable | Not started | — |
| X2 | devex-ux-agent | `NO_COLOR`/`--no-color` (G14), WCAG contrast validation (G13), error/empty/confirm components (G15) | X1, S2 | ANSI-free output proven by test; **real contrast numbers for all 4 built-in themes**; no new dependency | Not started | — |

**Wave B outcome (verified, not merely reported).** Orchestrator re-ran the gate:
typecheck/lint/build pass, **189/189 tests, 18 files** (85 → 189; A2 added 50, X2 added 54).
`git diff --stat tests/` confirms the two pre-existing test files changed are **additions only**
(126 insertions, 1 deletion — an import line); no assertion was weakened.

A2 (architecture) — `src/cli/errors.ts` (60 lines: three exit constants, `NightshiftError`,
`describeError`, `reportFatal`), top-level handler in `src/index.ts` (still wiring-only),
`tryReadConfig()` in `store.ts`. **Exit-code contract: `0` success · `1` runtime *and* usage
failure · `2` corrupt config.** The agent ran Commander first and found it already exits `1` for
unknown command and missing argument, so usage errors share `1` rather than forcing
`exitOverride()`; `2` exists because it is the one distinction a script acts on differently.
Verified: all 4 corrupt-config variants × 4 commands = **16 combinations, zero stack traces**;
`--help` and `--version` still exit 0. Design decision: readers (`status`, `profile list|show`)
**degrade and report** (full output, active ids shown as `none`, corruption named on stderr,
exit 2) because `status` is run *because* something is wrong; writers (`readConfig()`) **fail**,
because degrading to defaults on a write path would overwrite the user's file with invented
values.

X2 (devex-ux) — `src/cli/ui/feedback.ts`, `color-mode.ts`, `src/core/themes/contrast.ts`.
Two findings here mattered more than the features:

- **G26 (new, High): every table overflowed the terminal by exactly +2 at every width**
  (120→122, 80→82, 60→62) — a flat `-2` border allowance against cli-table3's actual
  `columns+1`. Plus a hard ~57-column floor, and `COLUMNS=20` fell back to 100, rendering the
  *widest* table for the *narrowest* terminal. Fixed, with `tests/unit/table-width.test.ts`
  pinning it. This was invisible in piped output and only manifests in a real terminal.
- **G27 (new, Medium): `NO_COLOR` had zero effect.** The naive test is worthless — piped output
  is already ANSI-free, so `NO_COLOR=1 → 0 escapes` proves only that stdout was a pipe. Forcing
  `FORCE_COLOR=3` exposed the truth: 10/9/9/3/7 ANSI lines, unchanged. Two root causes: chalk
  lets `FORCE_COLOR` override `NO_COLOR` by design, and **boxen snapshots `chalk.level` at
  import time** (proven: level-0-before-import → 0 escapes; after → 8). Fixed; now 0 escapes
  across all six commands at `FORCE_COLOR=3`.

**Contrast measured — all four built-in themes pass WCAG AA 4.5:1 on all 24 pairs.** No
threshold was adjusted and no shipped color changed. Narrowest margin is `redline.primary` at
**4.98:1** — flagged so nobody darkens that red later. The math was verified against known
references (21:1, 1:1, sRGB primaries, #767676 = 4.54:1) *before* the theme numbers were
trusted, and the failure path was proven with a low-contrast *user* theme rather than by
editing a built-in.

| theme | background | fg | primary | secondary | success | warning | error |
|---|---|---|---|---|---|---|---|
| ghost-protocol | `#0A0D0B` | 15.28 | 12.21 | 6.12 | 12.21 | 10.34 | 6.24 |
| monolith | `#121212` | 14.64 | 8.14 | 5.43 | 8.92 | 8.14 | 5.53 |
| redline | `#0D0A0A` | 14.68 | **4.98** | 5.69 | 8.66 | 10.44 | 5.81 |
| deep-space | `#080B14` | 14.99 | 11.46 | 5.62 | 8.88 | 11.68 | 5.78 |

Two agents independently retracted a false finding rather than ship it — security-agent on G7
(see Wave A) and devex-ux-agent on an apparent backslash-eating bug in tables that turned out
to be heredoc mangling in its own probe. Both are recorded because a retraction is evidence the
verification is real.

Carried into Wave C-prep (deferred by A2 because devex-ux-agent held the files, now released):
**A-4** `doctor` reports a corrupt config as `✓ initialized` from `existsSync` alone;
**A-5** the 16-line rollback path duplicated at `theme.ts:131-146` ≡ `profile.ts:85-100`;
**A-6** extract the WT apply engine from `theme.ts` to `src/core/themes/apply.ts` *before* Wave
C adds three more commands to it; **F6** `profile export|remove|import` and `restore` give no
next step on failure; **F7** `detect.ts` builds `C:\Users\Amar/.claude/settings.json` by string
concatenation; and X2's `--no-color` follow-up — it is spliced out of `process.argv` before
Commander parses (Commander rejects unregistered options first), so the flag works but is
**invisible in `--help`** until it is registered on the root program.

### Wave 7 — Core CLI features (1 agent, both tasks; owns `src/index.ts` this wave)

| ID | Agent | Description | Deps | Acceptance criteria | Status | Test result |
|---|---|---|---|---|---|---|
| C1 | core-cli-agent | `nightshift setup [--yes]` — detect → **proposal** → approval → execute (G10, Phase 2) | A2, X2 | Non-TTY prints proposal and **writes nothing** (proven against temp `APPDATA`), exits 0, no hang; `--yes` configures and reports | Not started | — |
| C2 | core-cli-agent | `theme validate|create|remove` (G11, Phase 4) | A2, X2 | All failure paths demonstrated (invalid, duplicate, built-in id, active theme, traversal); new theme appears in `theme list` | Not started | — |

### Wave 8 — Features + bug fixes (2 agents, parallel)

| ID | Agent | Description | Deps | Acceptance criteria | Status | Test result |
|---|---|---|---|---|---|---|
| F2 | feature-agent | Font detection: `font list`, `font check`, `doctor` active-theme font check (G12, Phase 3 read-only) | C1/C2, X2 | Real fonts from this machine listed; exit 0/1 cases proven; detector unit-tested against a **fixture** dir for determinism | Not started | — |
| D2 | debugging-agent | Fix verified D1 defects + regression tests (G7, G8 and whatever D1 found) | D1, A2 | Each fix has a test **confirmed failing pre-fix**; no test skipped or weakened | Not started | — |

### Wave 9 — Performance implementation (1 agent, after command set is final)

| ID | Agent | Description | Deps | Acceptance criteria | Status | Test result |
|---|---|---|---|---|---|---|
| E2 | performance-agent | Lazy command-module loading + remove duplicated per-invocation I/O (G18) | E1, C1, C2, F2 | Before/after numbers, same method/run count; **`--help` output diffed and unchanged**; full gate passes; skipped opportunities named | Not started | — |

### Wave 10 — Tests and dependency hygiene (2 agents, parallel)

| ID | Agent | Description | Deps | Acceptance criteria | Status | Test result |
|---|---|---|---|---|---|---|
| Q2 | qa-testing-agent | Implement missing tests (G16, G17) + enable the agreed coverage threshold | Q1, all impl | Before/after test count and coverage reported; every new test would actually fail on regression; nothing skipped/`.only` | Not started | — |
| N2 | dependency-compat-agent | Fix `engines` floor (G21), `files` array (G19), remove unused deps, validate lockfile | N1, S2 | `npm ci` succeeds clean; `npm pack --dry-run` pasted with no stale/missing entries; engines == README == CI | Not started | — |

### Wave 11 — Build and release (1 agent)

| ID | Agent | Description | Deps | Acceptance criteria | Status | Test result |
|---|---|---|---|---|---|---|
| B2 | build-release-agent | `npm ci` in CI (G20), Node matrix (G21), `format:check` (G23), `prepublishOnly` (G22), fix G24, `RELEASE_CHECKLIST.md` | B1, N2, Q2 | Clean-build + install-from-tarball re-verified with real output; **nothing published, no tag pushed** | Not started | — |

### Wave 12 — Independent review (2 agents, parallel)

| ID | Agent | Description | Deps | Acceptance criteria | Status | Test result |
|---|---|---|---|---|---|---|
| R2 | code-review-agent | Review the whole cycle's diff → `docs/development/CODE_REVIEW_CYCLE.md` | all impl | Ran the gate **itself**; confirms or refutes each agent's completion claim rather than restating it | Not started | — |
| W2 | documentation-agent | Update `README.md`, `ROADMAP_STATUS.md`, `CHANGELOG.md`, `docs/CONFIGURATION-FORMATS.md` | W1, all impl | Every documented example actually run; Implemented/Partial/Planned framing intact; no still-true limitation deleted | Not started | — |

### Wave 13 — Integration and final validation (1 agent, both tasks)

| ID | Agent | Description | Deps | Acceptance criteria | Status | Test result |
|---|---|---|---|---|---|---|
| I1 | integration-agent | Collision map from the real `git diff` → `docs/development/INTEGRATION_REPORT.md` | all | Every multi-author file checked for **lost edits**, especially that `src/index.ts` still registers every command | Not started | — |
| I2 | integration-agent | Resolve collisions; validate the combined product end to end | I1 | Per-command exit-code table with real output; explicit verdict on whether the combined project works | Not started | — |

### Wave 14 — Acceptance (orchestrator)

| ID | Agent | Description | Deps | Acceptance criteria | Status | Test result |
|---|---|---|---|---|---|---|
| P2 | planner-architect | Final acceptance; `PROJECT_COMPLETION_REPORT.md`; `ROADMAP_STATUS.md` reconciled | I2, R2, W2 | Report distinguishes completed / tested / partial / unverified; nothing claimed without evidence | Not started | — |

---

## 4. Dependency graph

```
Wave 1 (A1 R1 S1 X1 F1 W1 N1)  ─┐
Wave 2 (D1 B1)                  ─┤
Wave 3 (Q1) ── Wave 4 (E1) ─────┴─> Wave 5 (S2)
                                        │
                        ┌───────────────┴───────────────┐
                     Wave 6 (A2)                   Wave 6 (X2)
                        └───────────────┬───────────────┘
                                        v
                               Wave 7 (C1, C2)
                                        │
                        ┌───────────────┴───────────────┐
                     Wave 8 (F2)                   Wave 8 (D2)
                        └───────────────┬───────────────┘
                                        v
                               Wave 9 (E2)   <-- must be last src/index.ts writer
                                        │
                        ┌───────────────┴───────────────┐
                     Wave 10 (Q2)                  Wave 10 (N2)
                        └───────────────┬───────────────┘
                                        v
                               Wave 11 (B2)
                                        │
                        ┌───────────────┴───────────────┐
                     Wave 12 (R2)                  Wave 12 (W2)
                        └───────────────┬───────────────┘
                                        v
                            Wave 13 (I1 -> I2)
                                        v
                               Wave 14 (P2)
```

**Critical path:** S2 (Zod 4 major) → A2 (error contract) → C1/C2 (new commands) → E2 (lazy
imports) → B2 (packaging) → I2 (integration). S2 is first because every schema file and several
tests depend on the Zod version; doing it after feature work would mean reworking new code.

---

## 5. Integration checkpoints

| After wave | Checkpoint | Who |
|---|---|---|
| 5 | Full gate green on Zod 4; security tests still assert the same protections | orchestrator |
| 7 | New commands registered and runnable; `--help` complete | orchestrator |
| 9 | `--help` byte-identical to pre-E2; integration suite unchanged and passing | orchestrator |
| 11 | Clean build + install-from-tarball | build-release-agent |
| 13 | Every command exercised; exit-code table | integration-agent |

## 6. Agent assignment summary

Fourteen agents, **exactly two primary tasks each** — 28 tasks total. Full registry with
responsibilities and deliverables: `docs/development/AGENT_REGISTRY.md`.

## 7. Blockers

| Blocker | Impact | Owner | Status |
|---|---|---|---|
| No interactive TTY available to agents | `@clack/prompts` rendering, arrow-key navigation, and Escape/Ctrl+C behavior cannot be verified by any agent | devex-ux-agent records a human-verification list | Open — accepted, documented, not worked around |
| Linux/macOS not executable here | Phase 9 adapters and cross-platform claims cannot be verified | dependency-compat-agent labels as unverified | Open — accepted |
| `.claude/agents/` not dispatchable this session | Native `subagent_type` binding unavailable; see §2 | orchestrator | Open — mitigated via `general-purpose` + definition-file injection |
| Publishing requires human authorization | No npm publish, no tag push | build-release-agent prepares only | Open — by design |
