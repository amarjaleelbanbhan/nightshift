# NIGHTSHIFT — Orchestration Monitor Report

**Verdict: CLEAN**

Three passes over the shared working tree during Wave C/D (core-cli-agent ∥ debugging-agent ∥
dependency-compat-agent all running). **No lost edits. No deleted, skipped, or weakened tests.
No ownership violation that caused damage. No duplicate implementations. No smuggled
dependencies. No invariant breaches.** `npx tsc --noEmit` was clean on all three passes.

Nothing here requires intervention. Four low-severity advisories are listed in §3 for whoever
runs the next wave; none of them is damage and none blocks the gate.

Method note: this monitor is read-only on source. It never ran `npm run build`, `npm test`,
`npm install`, or `npx vitest run`, and never executed a writing CLI path. Test counts below
are **derived statically** from declaration + `it.each`/loop expansion, not from a test run —
the orchestrator's gate remains the authoritative count.

---

## 1. Confirmed findings

**None.** Every item on the monitoring checklist was verified present and intact.

---

## 2. Verification detail, by checklist item

### 2.1 Lost edits — the highest-value check

`src/index.ts` is the one file three agents have legitimate claims on. All four required
properties survive core-cli-agent's additions, re-verified on pass 2 and pass 3 after the file
was rewritten mid-flight:

| Required | Status | Location |
|---|---|---|
| architecture-agent's top-level `try/catch` → `reportFatal` | present | `src/index.ts:146-150` |
| `--no-color` root option (registered so it shows in `--help`) | present | `src/index.ts:39` |
| `allowExcessArguments(true)` + stray-positional check | present | `src/index.ts:138-144` |
| every command registered | present — 22 `.command()` registrations, incl. new `setup`, `theme validate\|create\|remove` | `src/index.ts:41-131` |

`src/index.ts` is still wiring-only: no handler logic, no `fs`, no formatting.

`src/cli/commands/theme.ts` is **still printers-only**. A6 extraction holds: zero `fs.*`,
`readFileSync`, `writeFileSync`, `createBackup`, `restoreBackup`, `atomicWrite`, or
`mergeThemeIntoSettings` references in the file. The engine lives in `src/core/themes/apply.ts`
and the authoring logic in `src/core/themes/manager.ts`; `theme.ts` calls them and formats the
result. Re-confirmed on pass 3 after core-cli-agent edited the file.

`src/core/profiles/manager.ts` — security-agent's promotion is **intact**:
`src/core/profiles/manager.ts:10` imports `MAX_JSON_FILE_BYTES` from `../../security/limits.js`
and uses it at `:36` and `:39`. No local `MAX_IMPORT_BYTES` was reintroduced anywhere in the
tree. core-cli-agent edited this file (A-10 fix, see below) without disturbing it.

Error-path regression check — `chalk.red`/`console.error` instead of `src/cli/ui/feedback.ts`:
the devex-ux migration is **intact and complete** on the failure paths. `git diff` shows the old
`console.error(chalk.red(result.message))` idiom replaced by `failWith(...)` at every site in
`src/cli/commands/profile.ts`, and `console.log(chalk.green(...))` replaced by
`successMessage(...)`. Three `console.error(chalk.red(...))` calls remain, but they are *newly
added* by architecture-agent for the degraded config-corrupt advisory, not survivors of the old
idiom — see §3.1.

### 2.2 Ownership

`git diff --name-only` plus untracked files cross-referenced against the ownership table. Every
modified file maps to an agent with a plausible claim. Files touched outside the stated table,
with the agent inferred from content (**inference, not certainty** — the tree records no author):

| File | Inferred author | Assessment |
|---|---|---|
| `src/cli/commands/status.ts`, `profile.ts`, `backup.ts`, `init.ts` | devex-ux-agent (feedback migration) + architecture-agent (`EXIT_CONFIG_CORRUPT`) | Benign. Both agents are complete and their changes coexist in the diff without overwriting each other. |
| `src/cli/commands/doctor.ts` (+77) | architecture-agent (A-4) + devex-ux-agent (contrast check) | Benign and high quality — fixes A-4 (`doctor` reported a corrupt config as `✓ initialized` from `existsSync` alone) and routes the exit code through `EXIT_FAILURE`/`EXIT_CONFIG_CORRUPT`. |
| `src/core/capabilities/detect.ts` | debugging-agent (F7) | Benign — a 1-line `path.join` fix for the mixed-separator `C:\Users\x/.claude/...` path. |
| `src/core/profiles/registry.ts`, `src/core/profiles/schema.ts` | security-agent (Zod 4 + `readJsonFileWithLimit`) | Benign, Wave A work. |
| `vitest.config.ts` | debugging-agent or devex-ux-agent | Benign — raises `testTimeout`/`hookTimeout` to 30 s with a recorded root cause (integration tests spawn the real binary at ~800-1400 ms per invocation, so a 5-invocation test sat on vitest's 5000 ms default and a *different* file timed out each run). This loosens a timeout, not an assertion. |
| `tests/integration/profile-import-export.test.ts` | core-cli-agent (A-10 regression test) | Benign, addition-only (+19/-0). A pre-existing tracked test file written by an agent whose ownership line does not mention `tests/`; it did not collide with debugging-agent's test files. |

No file shows signs of one agent's write landing on top of another's.

### 2.3 Test integrity — the floor held and rose

| | Pass 1 | Pass 2 | Pass 3 |
|---|---|---|---|
| test files | 19 | 22 | **24** |
| `it(` declarations | 150 | 180 | **200** |
| `it.each(` declarations | 5 | 5 | **8** |
| `test(` declarations | 1 | 1 | **1** |
| source declarations | 156 | 186 | **209** |
| derived runtime cases | ~205 | ~235 | **~268** |

Derivation of the runtime figure (pass 3): 209 source declarations, plus loop/`it.each`
expansion — `tests/integration/error-handling.test.ts` +27 (a 4×4 nested loop and four `it(`
inside a 4-element loop), `tests/integration/no-color.test.ts` +15 (3 × `it.each(COMMANDS)`,
6 commands), `tests/unit/errors.test.ts` +3, `tests/unit/windows-terminal-apply.test.ts` +4,
`tests/unit/wt-settings-shapes.test.ts` +5, `tests/integration/backup-metadata.test.ts` +5.
≈ **268**, against a floor of 204. Strictly rising across all three passes.

- `.skip` / `.only` / `.todo` / `xit(` / `xdescribe(`: **zero occurrences**, all three passes.
- Commented-out `expect(`: **zero occurrences**.
- `git diff --numstat tests/` on the three tracked test files: `+19/-0`, `+77/-1`, `+49/-0`.
  The single deletion is an **import line** in `tests/security/malformed-import.test.ts`
  (`import { getUserThemesDir }` widened to `import { getUserThemesDir, getConfigFilePath }`).
  **Zero test cases deleted. Zero assertions weakened.**
- Assertion-strength sweep for relaxations (`toBe` → `toBeDefined`, `toThrow(X)` → `toThrow()`):
  no existing assertion was relaxed. The `toBeDefined()` uses are on random UUID backup ids
  (`result.backupId`), where an exact value cannot be asserted. Two *new* bare `toThrow()` calls
  are noted in §3.4.
- New test files added this cycle, all with no skips: `tests/integration/setup.test.ts`,
  `tests/integration/theme-authoring.test.ts`, `tests/integration/backup-metadata.test.ts`,
  `tests/unit/theme-manager.test.ts`, `tests/unit/wt-settings-shapes.test.ts`.

Spot-check of quality rather than count: `tests/integration/setup.test.ts:97-110` asserts the
non-TTY path writes **nothing** — it checks `fs.existsSync(configRoot) === false` *and* that
Windows Terminal's `settings.json` is byte-identical to before *and* `exitCode === 0`. That is
the C1 acceptance criterion asserted properly, not approximated.

### 2.4 Duplicate implementations

Exactly one implementation of each named concern. Grepped for definitions, not just usages:

| Concern | Single home | Shared by |
|---|---|---|
| contrast / luminance | `src/core/themes/contrast.ts:32,51,66,75` | `theme validate`, `doctor`, tests |
| safe path resolution | `src/security/paths.ts:17,31` | 5 modules, 14 call sites |
| JSON size guard | `src/security/limits.ts:13,30` | config store, both registries, both managers |
| backup/rollback sequence | `recordActiveState` in `src/core/themes/apply.ts:99` | `theme apply` and `profile apply` — A-5 collapse holds; `src/cli/commands/profile.ts:86-87` explicitly documents sharing it rather than copying it |
| error formatting | `errorMessage` in `src/cli/ui/feedback.ts:18`, consumed by `reportFatal` in `src/cli/errors.ts:75` | all commands |

The two `stat.size > MAX_JSON_FILE_BYTES` checks at `src/core/profiles/manager.ts:36` and
`src/core/themes/manager.ts:83` look like a third copy of the size guard but are **not** a
finding: both share the one constant, both are documented in-place with the reason
(`readJsonFileWithLimit` *throws* `FileTooLargeError`, which the exit-code contract maps to
code 2 = "my own config is broken" — wrong for a file the user just pointed at, which needs a
Result and code 1), and both reuse a `stat` already taken for the `isFile()` check.

### 2.5 Architectural invariants

| Invariant (`docs/ARCHITECTURE.md`) | Result |
|---|---|
| no `console.*` under `src/core/`, `src/adapters/`, `src/backup/`, `src/security/`, `src/utils/` | **zero occurrences**, all three passes |
| `cli-table3` / `boxen` / `@clack/prompts` only under `src/cli/ui/` | holds. The only hit outside is a **doc comment** mentioning clack at `src/banners/startup.ts:18` — not an import. `@clack/prompts` is imported exactly once, at `src/cli/ui/prompts.ts:1`. |
| no `path.join` on user-supplied input bypassing `src/security/paths.ts` | holds. All 25 `path.join`/`path.resolve` sites operate on internal or derived paths; every user-supplied id goes through `resolveSafePath`. The two `path.resolve(process.cwd(), sourcePath)` sites (`profiles/manager.ts:23`, `themes/manager.ts:72`) are the deliberate "import/validate a file from anywhere the user can read" surface, size-capped and `isFile()`-checked. |
| `src/index.ts` stays wiring-only | holds |
| new interactive prompts carry the TTY guard | holds. `process.stdin.isTTY && process.stdout.isTTY` guards both interactive entry points: `src/cli/interactive/home.ts:32` and the new `src/cli/commands/setup.ts:131`. In `setup` the guard doubles as the safety property — with no way to obtain consent it writes nothing, and `src/cli/commands/setup.ts` is structured so the proposal is built and printed by functions that perform no writes at all. |

Also clean: zero `as any`, zero `as unknown as`, zero `@ts-ignore`/`@ts-expect-error`, zero
`eslint-disable` anywhere in `src/` or `tests/`.

### 2.6 Dependencies

`package.json` is unchanged since the Wave A baseline — dependency-compat-agent has not written
to it yet. Nothing smuggled:

- runtime: `@clack/prompts`, `boxen`, `chalk`, `cli-table3`, `commander`, `strip-ansi`, `zod` — **exactly the approved set**.
- dev: `@types/node`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `eslint`, `prettier`, `tsx`, `typescript`, `vitest` — **exactly the approved set**. `@vitest/coverage-v8` not yet present, which is correct for this wave.
- `overrides` → `@typescript-eslint/typescript-estree` → `minimatch: ^11.0.8`: **present and intact.**
- The only version movement is the Wave A work already accepted (`zod` ^3.24.1 → ^4.6.7, `vitest` ^3.0.2 → ^5.1.0, `@typescript-eslint/*` ^8.19.1 → ^8.72.2).

### 2.7 Hygiene

- Stray temp/probe files (`tmp-*`, `*.mjs` probes, `*.tgz`, `engine-probe.*`, `*.log`, `*.bak`): **none**, anywhere in the tree, all three passes. Repo root is clean.
- Merge-conflict markers: **none**.
- `TODO` / `FIXME` / `XXX` / `HACK` in `src/` or `tests/`: **none**.

---

## 3. Advisories (low severity, no intervention needed)

### 3.1 Three config-corrupt advisories bypass `errorMessage()`, losing the `✗` glyph

`src/cli/commands/theme.ts:19`, `src/cli/commands/status.ts:44`,
`src/core/profiles/manager.ts`'s caller at `src/cli/commands/profile.ts:23` each do:

```ts
console.error(chalk.red(configResult.error.message));
process.exitCode = EXIT_CONFIG_CORRUPT;
```

These are the degraded-reader path (print the full report, name the corruption on stderr, exit
2) and are **newly added by architecture-agent**, not leftovers of the pre-migration idiom —
`failWith()` is the wrong call here because it hardcodes `process.exitCode = 1`. So this is
non-adoption of `errorMessage()`, not a lost edit.

The consequence is small but real: `src/cli/errors.ts:70-71` records that the `✗` glyph "is what
carries the meaning when color is off", and under `NO_COLOR` these three lines are bare
unmarked text. The one-line fix is `console.error(errorMessage(configResult.error.message))`,
keeping the explicit `EXIT_CONFIG_CORRUPT` assignment. Owner: whoever next holds those three
files. Not urgent; no test depends on it either way.

### 3.2 `files` array names two directories that do not exist

`package.json` `files: ["dist","themes","profiles","schemas"]` — `themes/` and `schemas/` are
**absent from the repo root**. This is squarely dependency-compat-agent's open N2 task
(`engines`/`files`), so it is listed as context, not as a finding against anyone.

### 3.3 `engines.node` floor is likely below what `vitest@5` requires

`engines` still reads `">=18.0.0"`, while Wave A moved `vitest` to `^5.1.0`, whose own floor is
above Node 18. Dev-only reach, and it is exactly the "verified Node floor with named cause"
deliverable N1/N2 is open on. Flagged so it is not missed.

### 3.4 Two new bare `toThrow()` assertions, and a dangling doc reference

- `tests/integration/profile-import-export.test.ts:282` and `tests/unit/theme-manager.test.ts:250`
  use bare `toThrow()` where the thrown type is known (`ConfigCorruptError`). Not a weakening —
  both are brand-new assertions, and in both the load-bearing claim is the *next* line (the file
  survived). Tightening to `toThrow(ConfigCorruptError)` would be strictly better.
- `vitest.config.ts` cites `docs/development/PERFORMANCE_REPORT.md`, which does not exist yet
  (Wave E has not run). Every other missing `docs/development/*.md` reference is a
  forward-reference inside `IMPLEMENTATION_PLAN.md` and expected; this is the only one in
  shipped source.

---

## 4. Transient / mid-edit observations — do NOT act on these

Recorded for timeline visibility. None is a finding.

**Pass 1 → pass 3: the tree moved substantially under the monitor.** Test files went 19 → 22 →
24 and source declarations 156 → 186 → 209 within the run. `src/index.ts`,
`src/cli/commands/theme.ts`, `src/cli/commands/setup.ts`, `src/cli/interactive/home.ts`, and
`src/core/profiles/manager.ts` were all rewritten between passes. The critical-invariant
checklist in §2.1 was re-run after each change and held every time. **`npx tsc --noEmit`
returned clean on pass 1, pass 2, and pass 3** — no transient type error was ever observed, so
nothing needs a re-check.

**G25 was open at pass 1 and closed by pass 3 — this is progress, not damage.** At pass 1,
`src/adapters/windows-terminal/apply.ts:72-73` still treated `settings.profiles` as an object
with no `Array.isArray` guard (the legacy-array defect recorded in the Wave A outcome). By
pass 3, debugging-agent had added `requirePlainObject()` (`src/adapters/windows-terminal/apply.ts:65-84`),
which **refuses** a legacy array with a message telling the user to let Windows Terminal migrate
the file, rather than guessing at a migration — plus `tests/unit/wt-settings-shapes.test.ts`
(14 declarations) pinning it. The design choice to refuse rather than rewrite is the
conservative one and matches the project's stated posture on user-owned files. F-1 (unvalidated
`metadata.originalPath` in `restoreBackup`) is being closed in parallel via
`tests/integration/backup-metadata.test.ts`.

If the gate had been run between pass 1 and pass 3 it could have caught that fix half-landed
(tests asserting a throw that the source did not yet perform). At pass 3 source and tests are
consistent and typecheck is clean. I verified the new throw does not break existing callers:
every pre-existing test that reaches `mergeThemeIntoSettings` passes a well-formed `profiles`
object (`tests/unit/windows-terminal-apply.test.ts:22`,
`tests/integration/theme-apply-engine.test.ts:28`, `tests/integration/profile-apply.test.ts:35`),
and the `{ schemes: ... }`-only cases hit the `value === undefined → {}` branch.

**Possible test-file overlap, for integration-agent, not for intervention.**
`tests/unit/windows-terminal-apply.test.ts` (debugging-agent's G7 hostile-shape block) and the
new `tests/unit/wt-settings-shapes.test.ts` both exercise malformed `settings.json` shapes
against `mergeThemeIntoSettings`. Same owner, different concern (`schemes` vs `profiles`), so
this is likely deliberate separation rather than duplication — but it is the kind of thing §3 of
`AGENT_REGISTRY.md` assigns to integration-agent to collapse. Worth a look at Wave J; nothing to
do now.

**dependency-compat-agent had produced no observable writes** in any of the three passes.
`package.json` and `package-lock.json` are byte-identical to their Wave A state throughout. Not
a concern — just an observation that §3.2 and §3.3 remain open.
