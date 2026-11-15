# Performance Report — startup cost of a one-shot CLI

Owner: performance-agent. Covers plan items **E1** (measure/attribute) and **E2** (implement).
Addresses **G18** and its downstream consequence **G28**.

Every NIGHTSHIFT command is a one-shot `node` invocation and `docs/ARCHITECTURE.md` forbids a
daemon, so **process startup is the entire felt performance of the product**. This report
measures it, attributes it, and records what was changed.

## Machine and method

| | |
|---|---|
| Host | Windows 11 Pro 10.0.22631, `win32` x64 |
| Node | v26.12.1 |
| Binary measured | `node dist/index.js` (the built output, never `tsx` on source) |
| Config root | `APPDATA=$(mktemp -d)` per benchmark run, so no developer state leaks in |
| Timer | `process.hrtime.bigint()` around `child_process.spawnSync`, `stdio: "ignore"` |
| Runs | **15 per case**, preceded by a discarded 3-run warm-up to prime the OS file cache |
| Reported | **min** and **median**. Max is shown for the baseline because the spread is the story |
| Load | Machine idle, no other agent running. No benchmarking dependency was added |

Probe scripts lived in a scratch temp directory outside the repository and were deleted
afterwards. Nothing in `dist/` or `src/` was instrumented for the timing runs.

### Why min *and* median

Windows process spawn is noisy. A single timing is worthless: the baseline `--help` case ranged
630 ms → 2250 ms across 15 runs of identical work. `min` is the closest thing to the real cost
(least interference); `median` is what a user actually feels. Both are reported for every case.

## Node's own floor

NIGHTSHIFT cannot be faster than `node` starting up. Measured so that every number below can be
read as NIGHTSHIFT's *marginal* cost rather than Node's.

| Case | min | median | max |
|---|---|---|---|
| `node -e ""` | 75 ms | **85 ms** | 96 ms |
| `node --eval "process.exit(0)"` | 77 ms | **86 ms** | 111 ms |

**Node's floor is ~85 ms.** Everything above that is ours.

## E1 — baseline, before any change

15 runs each, isolated `APPDATA`.

| Command | min | median | max | marginal (median − 85 ms) |
|---|---|---|---|---|
| `--version` | 630 ms | **663 ms** | 784 ms | 578 ms |
| `--help` | 657 ms | 748 ms | 2250 ms | 663 ms |
| `status` | 698 ms | 728 ms | 1142 ms | 643 ms |
| `doctor` | 638 ms | 655 ms | 719 ms | 570 ms |
| `theme list` | 638 ms | 653 ms | 790 ms | 568 ms |
| `theme preview ghost-protocol` | 645 ms | 657 ms | 1272 ms | 572 ms |
| `theme validate <file>` | 638 ms | 653 ms | 944 ms | 568 ms |
| `profile list` | 659 ms | 683 ms | 1100 ms | 598 ms |
| no-args, non-TTY | 691 ms | 705 ms | 785 ms | 620 ms |

The shape is the finding: **every command costs the same.** `--version`, which does nothing but
print a string Commander already holds, is within 10 ms of `status`, which detects capabilities,
reads config, scans two registries and renders a panel plus a table. The work a command does is
noise next to the cost of loading the module graph, and the graph is identical for all of them
because `src/index.ts` imports every command module at module scope.

## Attribution — where the 578 ms goes

### Per-dependency import cost

Each dependency imported alone in a **fresh process**, timed with `performance.now()`-equivalent
`process.hrtime.bigint()` around a dynamic `import()` of the resolved entry point. 9 runs each.
Measured from a scratch directory, resolving through `createRequire("D:/CTP/package.json")`, so
no NIGHTSHIFT module was loaded alongside.

| Dependency | min | median |
|---|---|---|
| **zod** | 219.2 ms | **227.9 ms** |
| **boxen** | 107.2 ms | **125.1 ms** |
| `@clack/prompts` | 38.1 ms | 40.5 ms |
| `commander` | 19.0 ms | 21.6 ms |
| `cli-table3` | 19.9 ms | 21.0 ms |
| `chalk` | 18.0 ms | 18.9 ms |
| `strip-ansi` | 3.4 ms | 3.7 ms |

**zod and boxen are 353 ms of the 578 ms on their own** — 61 % of NIGHTSHIFT's entire marginal
startup cost, in two libraries. `--version` touches neither. zod validates theme and profile
JSON; boxen draws the panel border on `status`.

### Per-module import cost (built output)

Same method, importing `dist/**` modules in a fresh process. These are cumulative — each number
includes everything that module transitively pulls in.

| Module | min | median | why |
|---|---|---|---|
| `cli/interactive/home.js` | 512.0 ms | **534.6 ms** | the whole stack: clack + boxen + table + zod |
| `cli/commands/status.js` | 502.2 ms | **548.6 ms** | banner (boxen) + table + both registries (zod) |
| `cli/commands/profile.js` | 420.5 ms | 453.8 ms | registries (zod) + table |
| `cli/commands/doctor.js` | 397.3 ms | 444.5 ms | registries (zod) + table |
| `cli/commands/backup.js` | 387.3 ms | 419.4 ms | |
| `cli/commands/theme.js` | 357.9 ms | 370.3 ms | |
| `cli/commands/setup.js` | 345.1 ms | 353.4 ms | |
| `core/config/store.js` | 263.3 ms | **322.2 ms** | **zod, for a 4-field config schema** |
| `cli/commands/init.js` | 295.2 ms | 311.0 ms | |
| `cli/errors.js` | 288.8 ms | **300.2 ms** | **zod, via `ConfigCorruptError`** |
| `core/themes/registry.js` | 273.6 ms | 282.4 ms | zod |
| `core/profiles/registry.js` | 256.2 ms | 269.7 ms | zod |
| `cli/ui/panel.js` | 123.6 ms | 128.2 ms | boxen |
| `cli/ui/table.js` | 52.2 ms | 63.6 ms | cli-table3 |
| `cli/ui/feedback.js` | 28.0 ms | 29.7 ms | chalk + color-mode |
| `core/capabilities/detect.js` | 10.9 ms | 11.3 ms | |
| `cli/version.js` | 9.8 ms | 10.9 ms | reads `package.json` |
| `security/limits.js` | 7.5 ms | 7.9 ms | |
| `core/config/paths.js` | 3.9 ms | 4.3 ms | |

**`cli/errors.js` costing 300 ms is the trap.** `src/index.ts` must import it eagerly — it holds
the top-level error handler. It imported `ConfigCorruptError` from `core/config/store.ts`, and
that module builds a zod schema at module scope. So **zod was loaded on every single invocation
purely to satisfy an `instanceof` check in `describeError()`**, and no amount of lazy *command*
loading would have removed it.

### How much of a `--version` run is wasted

`--version` needs `commander`, `cli/version.js`, and whatever the top-level error handler needs.
Measured as a set, in a fresh process, 9 runs:

| Eager set | min | median | predicted `--version` (+ 85 ms Node) |
|---|---|---|---|
| `commander` + `cli/version.js` + `cli/errors.js` *(lazy commands only)* | 305.9 ms | 326.2 ms | ~411 ms |
| `commander` + `cli/version.js` + `cli/ui/feedback.js` *(lazy commands **and** zod off the error path)* | 51.6 ms | **55.0 ms** | **~140 ms** |

So of the 578 ms marginal cost of `--version`, roughly **523 ms (90 %) is spent on modules that
`--version` never touches.** Lazy command loading alone recovers about half of it; it only
recovers the other half if `cli/errors.ts` also stops dragging in zod.

### Avoidable repeat I/O

`fs.existsSync`/`readFileSync`/`readdirSync`/`statSync`/`openSync` were counted per path by
monkey-patching `fs` from a `--import` preload (outside the repo), then filtering to paths
touched more than once.

| Command | distinct fs calls | total fs calls | repeated |
|---|---|---|---|
| `status` | 352 | 353 | `2x existsSync .../nightshift/config.json` |
| `doctor` | 353 | 355 | `3x existsSync .../nightshift/config.json` |
| `theme list` | 351 | 351 | none |
| `profile list` | 357 | 357 | none |

Two observations.

1. **There is almost no redundant application I/O.** 351 of ~353 calls are Node's own module
   resolution — more evidence that the module graph, not the command logic, is the cost.
   `detectCapabilities()` and `tryReadConfig()` are each called exactly once per command.
   `architecture-agent`'s earlier removal of a redundant config read in `doctor` appears to have
   been the only one; nothing comparable remains.
2. **The only duplication left is `existsSync` on `config.json`** — `tryReadConfig()` checks it,
   then `isInitialized()` checks it again (`status`), and `doctor` calls `isInitialized()` twice
   (once in `runDoctor`, once in `activeThemeContrastCheck`). Measured cost of one
   `fs.existsSync` on this machine: **0.077 ms** (10 000 iterations). So the entire available win
   is **0.08 ms for `status` and 0.15 ms for `doctor`** — three orders of magnitude below the
   run-to-run spread. See "Deliberately skipped".

Two further near-misses that turned out not to be real:

- `runProfileList` calls `getTheme()` once **per row**, and `getTheme()` can scan the user themes
  directory. But `getTheme()` fast-paths built-in ids before touching the filesystem
  (`core/themes/registry.ts:40`), and both bundled profiles reference built-in themes — hence
  `profile list` showing **zero** repeated reads above. The quadratic shape only appears for a
  profile pointing at a *user* theme, and at 2 bundled profiles the worst case is 2 `readdir`s.
- `cli/interactive/home.ts` calls `listThemes()` at four sites and `listProfiles()` at two, but
  they are mutually exclusive menu branches — one executes per invocation.

## Ranked opportunities, by measured win

| # | Opportunity | Measured win on `--version` | Verdict |
|---|---|---|---|
| 1 | **Lazy command-module loading** — dynamic `import()` inside each Commander action, registration stays eager | **~250 ms** (663 → ~411) | Taken |
| 2 | **Get zod off the eager error path** — `ConfigCorruptError` into a zod-free module | **~270 ms** (411 → ~140) | Taken |
| 3 | Make `cli/errors.js` itself lazy (dynamic `import()` inside the top-level `catch`) | ~38 ms | See below |
| 4 | Lazy `boxen` inside `cli/ui/panel.ts` | 0 ms once #1 lands | Skipped — subsumed |
| 5 | De-duplicate `existsSync` on `config.json` | 0.08–0.15 ms | Skipped — noise |

#1 and #2 are not independent alternatives; **#2 only pays once #1 has landed**, because before
#1 the command modules pull zod in anyway. Together they are worth ~520 ms of the 578 ms.

---

## E2 — what changed

### 1. Lazy command-module loading (`src/index.ts`)

Every Commander action handler became `async () => (await import("./cli/commands/x.js")).runX()`.
**Registration stayed completely eager**: all 22 command/subcommand registrations, their options,
arguments and descriptions are still declared at module scope, so Commander's help generation is
untouched. `src/index.ts` remains wiring only — no logic moved into it.

### 2. zod off the eager error path (`src/core/config/errors.ts`, new)

`ConfigCorruptError` moved to a new 0-dependency module `src/core/config/errors.ts`.
`src/core/config/store.ts` re-exports it, so every existing import site and the public surface
are unchanged; `src/cli/errors.ts` now imports the class from the zod-free module. This is what
takes zod — 228 ms — off the path of *every* invocation.

### 3. One test, guarding the thing laziness can break silently

`tests/integration/cli.test.ts` gained one `it.each` block (10 cases) that enumerates all 22
command registrations and every option across the root and each command group's `--help`. The
pre-existing `--help` test asserted three substrings, which would not notice a command going
missing. A registration accidentally moved into a lazily imported module produces no error
anywhere — the command just stops existing — so this is the one failure mode that needed a test
rather than a one-off diff.

### 4. Opportunity #3 — deliberately not taken

Making `cli/errors.js` lazy measures at ~38 ms, which is real but is **16 % of the remaining
~140 ms for a 2x worse failure path**: the top-level `catch` would have to `await import()` the
module that reports errors, so a resolution failure inside the handler would produce exactly the
unhandled rejection the handler exists to prevent. `docs/ARCHITECTURE.md` makes "nothing escapes
as a raw stack trace" a contract. 38 ms does not buy that risk. Not taken.

### 5. Opportunity #5 — deliberately not taken

De-duplicating the `existsSync` on `config.json` is worth **0.08 ms** (`status`) and **0.15 ms**
(`doctor`), against a run-to-run spread of ±30 ms. It is unmeasurable in practice, and the
cheapest version of the change still means threading a boolean through
`activeThemeContrastCheck()` or widening `tryReadConfig()`'s return type — real cost in clarity
for a win that cannot be detected. The measurement is recorded above so the next person does not
have to repeat it. Not taken.

### 6. Opportunity #4 — subsumed

Lazily importing `boxen` inside `cli/ui/panel.ts` would have been worth 125 ms before #1. After
#1, `panel.ts` is only reachable from commands that actually render a panel, so the win is 0 ms.
Not taken.

## E2 — after

### A note on machine drift, and what was done about it

Partway through the after-measurements the machine's own baseline moved: `node -e ""` went from
a median of **85 ms** to **128–131 ms** and stayed there (background Windows activity; nothing
under this agent's control). That is a 1.5x shift in the floor, which is larger than most of the
wins being measured. Comparing a before-table taken at floor 85 ms against an after-table taken
at floor 129 ms would be meaningless, and reporting only the first after-run would have been
cherry-picking the favourable window.

So the authoritative before/after below is an **interleaved A/B**: the pre-change source was
built to `dist-before/` and the post-change source to `dist/`, and the harness alternates
`before`-run, `after`-run, `before`-run, … for each command. Any drift during the measurement
window therefore lands on both variants equally. 15 alternating pairs per command, floor measured
in the same run. The whole table was produced twice, ~20 minutes apart, and agreed to within
±3 % on every row — including the two rows that are not improvements.

### Interleaved A/B — authoritative

15 alternating pairs per command. `node -e ""` floor in this window: min 114 ms, **median 129 ms**.

| Command | before min | before med | after min | **after med** | **Δ median** |
|---|---|---|---|---|---|
| `--version` | 966 | 990 | 220 | **230** | **−760 ms (−77 %)** |
| `--help` | 925 | 1007 | 227 | **260** | **−747 ms (−74 %)** |
| `theme validate <file>` | 985 | 1002 | 729 | **780** | −222 ms (−22 %) |
| `doctor` | 935 | 1024 | 755 | **807** | −218 ms (−21 %) |
| `theme list` | 929 | 1029 | 762 | **816** | −213 ms (−21 %) |
| `theme preview ghost-protocol` | 961 | 1015 | 745 | **818** | −197 ms (−19 %) |
| `profile list` | 950 | 1025 | 777 | **837** | −188 ms (−18 %) |
| `status` | 1026 | 1095 | 992 | **1051** | −44 ms (−4 %) |
| no-args, non-TTY | 1055 | 1088 | 1104 | **1156** | **+68 ms (+6 %)** |

### Absolute numbers from a matched quiet window

For a figure that is comparable to the E1 baseline table in absolute terms, this is the first
after-run, taken while the floor was still at median 85 ms — i.e. the same conditions the E1
baseline was measured under. 15 runs, same harness.

| Command | before med (floor 85) | after med (floor 85) | Δ |
|---|---|---|---|
| `--version` | 663 ms | **168 ms** (min 144) | −495 ms |
| `--help` | 748 ms | **169 ms** (min 155) | −579 ms |
| `theme validate <file>` | 653 ms | 498 ms | −155 ms |
| `doctor` | 655 ms | 500 ms | −155 ms |
| `profile list` | 683 ms | 519 ms | −164 ms |
| `theme preview ghost-protocol` | 657 ms | 525 ms | −132 ms |
| `theme list` | 653 ms | 554 ms | −99 ms |
| `status` | 728 ms | *(contaminated: med 976, max 2253)* | see A/B |
| no-args, non-TTY | 705 ms | 720 ms | +15 ms |

`status` in that window hit a load spike mid-run; its honest number is the interleaved −4 %.
Everything else agrees with the A/B to within the expected spread.

**`--version` went from 663 ms to 168 ms — a marginal cost of 578 ms down to 83 ms over Node's
floor, an 86 % reduction in NIGHTSHIFT's own startup cost.**

### The two rows that are not wins

Both are reported because they are real, reproducible across two separate A/B runs, and
explainable.

- **`status`, only −4 %.** `status` renders the boxen status panel *and* reads both registries,
  so its own module graph is nearly the whole old eager graph — everything except
  `@clack/prompts` (40 ms) and the theme/profile manager modules. There was almost nothing for
  laziness to remove. The 244 ms gap between `status` (1051) and `doctor` (807) in the A/B is
  boxen, which `status` genuinely uses.
- **no-args, non-TTY: +68 ms (+6 %), a real regression.** The interactive home needs the entire
  stack — clack, boxen, table, both registries — so laziness saves it nothing, while the dynamic
  `import()` costs it one serialized module-resolution pass that it previously got overlapped
  with the rest of the eager graph. This is the correct trade and is being taken knowingly:
  68 ms on the path where the user is about to sit in a menu, in exchange for 760 ms off
  `--version`/`--help` and ~200 ms off every one-shot command. Making the interactive module
  eager again to recover it would put the whole stack back on `--version` and undo the entire
  change.

### Remaining opportunity, measured but out of scope

The floor for `status`/`doctor`/`theme list`/`profile list` is now **zod** (227.9 ms measured
alone) plus, for `status`, **boxen** (125.1 ms). Those are the next 200–350 ms and they are not
reachable by import scheduling — zod is loaded because `core/config/store.ts`,
`core/themes/schema.ts` and `core/profiles/schema.ts` build schemas at module scope, and those
schemas are the validation of untrusted user JSON. Replacing them is a correctness change to the
security surface, not a performance change, and is explicitly not attempted here.

### Test suite

| | before | after |
|---|---|---|
| Test files | 25 passed | 25 passed |
| Tests | 276 passed | **286 passed** (+10, nothing removed or skipped) |
| `vitest run` duration | 81.03 s | **61.37 s** |

The +10 are one `it.each` block in `tests/integration/cli.test.ts` that enumerates all 22
command registrations and every option, so that a registration accidentally moved into a lazy
module fails a test instead of silently vanishing from `--help`. `grep` for `.skip`/`.only`/
`.todo` across `tests/` returns nothing.

*Count discrepancy, recorded rather than glossed:* the brief stated a floor of 268 tests, and the
first `npm test` of this session did report 268. Re-running the suite with only this agent's
`src/` and `tests/` changes stashed reports **276** on the same tree, reproducibly, and no test
file generates cases dynamically. The 268 figure therefore appears to predate something else in
the tree rather than describing it. The relevant fact either way: **nothing was removed,
weakened, or skipped** — the baseline-on-this-tree is 276 and the after is 286.

The 61.37 s is also not a clean comparison (the floor had drifted up by then, which makes it a
conservative figure rather than a flattering one), but the direction is not in doubt: the suite's
cost is overwhelmingly subprocess startup, and most spawns in it are now 200–760 ms cheaper.

### `testTimeout` recommendation — recommend only, decision deferred

**Recommendation: keep `testTimeout: 30_000`. Do not tighten it.** `vitest.config.ts` was not
touched. Reasoning:

- `status` is the command the integration tests spawn most, and it is the row that barely
  improved (−4 %). A test spawning the binary 5 times still needs ~4–5 s of pure startup at the
  measured medians — **still at or above vitest's 5000 ms default**, which is precisely the
  condition that made G28 flaky.
- That cost is also load-dependent, which is what made the failure intermittent rather than
  reproducible: vitest reports `~684 ms startup each (spawn + environment, per file)` for 25
  workers, and those workers contend with the binary spawns under test.
- A generous timeout costs nothing when tests pass. A tight one converted a slow suite into an
  *intermittently red* suite, which cost more than the 20 s it saved.

A tighter value becomes defensible only once `status`'s per-spawn cost comes down too — i.e.
once zod is off the config/registry read path (see "Remaining opportunity"). That is a separate
change with a correctness surface and should not be assumed.

## Verification

| Check | Result |
|---|---|
| `--help` byte-identical, root + all 22 subcommands | `diff -r` → empty |
| ANSI count at `FORCE_COLOR=3`, `NO_COLOR=1`, 6 commands | all **0** |
| ANSI count at `FORCE_COLOR=3`, `--no-color`, 6 commands | all **0** |
| ANSI count at `FORCE_COLOR=3`, no opt-out (control) | 4–74, i.e. the check is meaningful |
| Corrupt `config.json` (`status`, `theme list`, `profile list`, `doctor`) | readable message, exit **2**, no stack trace — output byte-identical to before |
| Error thrown from inside a lazily imported module (`restore nope-123`, `restore ../../etc`, `profile show nope`, `theme preview nope`) | readable message, exit **1**, no stack trace, no unhandled rejection |
| Usage error (`nightshift bogusarg`) | `error: unknown command 'bogusarg'`, exit **1** |
| `format:check` / `typecheck` / `lint` / `build` | pass |
| `vitest run` | **286 passed / 25 files**, 0 skipped |

Commands used, so they can be re-run:

```sh
# --help, root + all 22 subcommands, before vs after
#   (capture.sh loops the 23 arg-lists through `node dist/index.js <cmd> --help`,
#    recording stdout, stderr and exit code per command into one directory)
capture.sh before/   # on the pre-change build
capture.sh after/    # on the post-change build
diff -r before/ after/        # -> no output

# colour opt-out, at FORCE_COLOR=3 (never a bare pipe)
for cmd in status doctor "theme list" "theme preview ghost-protocol" \
           "profile list" "backup list"; do
  FORCE_COLOR=3 APPDATA=$(mktemp -d) node dist/index.js $cmd              2>&1 | grep -oP '\033' | wc -l  # control: 4-74
  FORCE_COLOR=3 NO_COLOR=1 APPDATA=$(mktemp -d) node dist/index.js $cmd   2>&1 | grep -oP '\033' | wc -l  # 0
  FORCE_COLOR=3 APPDATA=$(mktemp -d) node dist/index.js $cmd --no-color   2>&1 | grep -oP '\033' | wc -l  # 0
done

# corrupt config still exits 2 with a readable message
A=$(mktemp -d); mkdir -p "$A/nightshift"; printf '{ "schemaVersion": ' > "$A/nightshift/config.json"
APPDATA="$A" node dist/index.js status; echo $?     # -> 2
```

Exact ANSI counts, before and after the change (identical):

| Command | control (FORCE_COLOR=3) | `NO_COLOR=1` | `--no-color` |
|---|---|---|---|
| `status` | 38 | **0** | **0** |
| `doctor` | 40 | **0** | **0** |
| `theme list` | 44 | **0** | **0** |
| `theme preview ghost-protocol` | 74 | **0** | **0** |
| `profile list` | 32 | **0** | **0** |
| `backup list` | 4 | **0** | **0** |

### Why `--no-color` did not break

`src/cli/ui/color-mode.ts` sets `chalk.level = 0` as an **import side effect**. The risk with
lazy imports is reordering that after output begins. It does not happen, for a reason that is
structural rather than lucky: ESM resolves a module's entire import graph *before* executing its
body, so by the time a lazily imported command's `runX()` runs, `color-mode.ts` has already
executed. `src/index.ts` prints nothing before the dynamic `import()`.

Verified at `FORCE_COLOR=3` rather than through a bare pipe. A piped stream is already
ANSI-free, so grepping a pipe for escapes proves nothing at all — `FORCE_COLOR=3` is what forces
chalk to colorize a non-TTY, which is the only way the opt-out is actually being tested.
