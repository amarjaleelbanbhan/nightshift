# Dependency, engine, and compatibility audit

Owner: dependency-compat-agent. Tasks N1 (audit) and N2 (fixes).
Environment the commands below were run in: **Windows 11 Pro 10.0.22631**, `node v26.12.1`,
`npm 12.2.1`, repo `D:\CTP`, branch `feat/nightshift-1.0.0`.

Every claim here traces to a command recorded in this document. Where a claim could not be
executed on this machine it is labelled **unverified** rather than asserted.

---

## 1. Headline finding: the declared Node floor is false

`package.json` claimed `"engines": { "node": ">=18.0.0" }`. **The real runtime floor is Node 22.**

| Source of the floor | Declared `engines.node` | Role |
|---|---|---|
| `boxen@9.0.0` | `>=22` | **runtime dependency — sets the floor** |
| `slice-ansi@9.0.1` (via `boxen`) | `>=22` | runtime transitive — same floor |
| `vitest@5.1.0` | `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` | dev — sets the *testable* floor at 22.12.0 |
| `@clack/prompts@1.9.0` | `>= 20.12.0` | runtime |
| `string-width@8.3.0`, `type-fest@5`, `widest-line@6`, `wrap-ansi@10`, `sisteransi@2`, `tagged-tag@1` | `>=20` | runtime transitive |
| `commander@13.1.0` | `>=18` | runtime |
| `chalk@5.6.2` | `^12.17.0 \|\| ^14.13 \|\| >=16.0.0` | runtime |
| `strip-ansi@7.2.0`, `ansi-regex@6.6.0` | `>=12` | runtime |
| `cli-table3@0.6.5` | `10.* \|\| >= 12.*` | runtime |
| `zod@4.6.7` | *(none declared)* | runtime |

**Verdict: `engines.node` fixed to `">=22.12.0"`.** Rationale:

- `>=18.0.0` was a false promise. A user on Node 18 or 20 installing this package gets an
  `EBADENGINE` warning from `boxen` and runs on a configuration `boxen` and `slice-ansi`
  explicitly do not support. Advertising a floor your own dependency rejects is a manifest
  correctness bug, not a nitpick.
- The dependency-declared floor is exactly `>=22.0.0` (`boxen`, `slice-ansi`).
- `22.12.0` rather than `22.0.0` because **`vitest@5.1.0` will not run below 22.12.0**, so
  nothing in `22.0.0 … 22.11.x` can ever be tested by this project's own suite. Per this
  agent's rule against claiming unverified support, the published floor is the lowest version
  the suite can actually execute on. `22.12.0` is also the first Node 22 LTS ("Jod") release,
  so this is the natural support boundary rather than an arbitrary pin.

### Honesty qualifier on `boxen`

`boxen@9.0.0`'s `>=22` appears to be a **maintainer support policy, not a hard API
requirement**. Its entry point uses no Node-22-only API:

```
$ grep -oE "(Object\.groupBy|Array\.fromAsync|\.withResolvers|structuredClone|require\(|node:[a-z]+)" node_modules/boxen/index.js | sort -u
node:process
```

So Node 20 would very likely *execute* fine. That does not change the conclusion: the
contract a dependency declares is what npm enforces and what a consumer must honour. But it
does mean the floor is **contract-driven, not capability-driven** — stated here so nobody
later reads `>=22.12.0` as "we measured a crash on 20".

### Language and runtime features actually used — these do *not* set the floor

Checked against the specific list requested. All are well below Node 22; the dependency
contract dominates.

| Feature | Found? | Where | Node minimum |
|---|---|---|---|
| Top-level `await` | **yes** | `src/index.ts` (`await program.parseAsync(process.argv)` inside a top-level `try`) | 14.8 (ESM) |
| `node:` prefixed imports | **yes** — `node:fs` ×26, `node:path` ×25, `node:os` ×17, `node:url` ×5, `node:crypto` ×2, `node:process` ×1 | throughout `src/`, `tests/` | 14.18 / 16 |
| `structuredClone` | **yes, tests only** — `tests/security/malformed-import.test.ts:80`, `tests/unit/theme-schema.test.ts:14,20,26,31`. **Not present anywhere in `src/`.** | tests | 17.0 |
| `Array.prototype.at` | **no** (`grep -rn "\.at(" src tests` → no matches) | — | — |
| `Object.hasOwn` | **no** (and no `hasOwnProperty` either) | — | — |
| `fs.rmSync` | **yes, tests only** — 10 call sites across `tests/integration/*`, none in `src/` | tests | 14.14 |
| `AbortSignal` / `AbortController` | **no matches in `src` or `tests`** | — | — |
| `import.meta.url` + `fileURLToPath` | yes | `src/core/profiles/registry.ts:3,9` | 12 |
| TS `target`/`lib` | `ES2022` (`tsconfig.json:3,6`) | — | 16.11 |

Feature-derived floor: **Node 17** (`structuredClone`, tests only). Dependency-derived floor:
**Node 22**. The floor is set by `boxen@9.0.0` / `slice-ansi@9.0.1`, bounded upward to
`22.12.0` by `vitest@5.1.0`.

### Severity: **High** (fixed in N2)

---

## 2. Every dependency

Collected by reading each installed package's own `package.json` out of `node_modules`
(the authoritative source for `engines`; `package-lock.json` does not record it):

```
$ for p in <each declared dep>; do node -e "const p=require('./node_modules/$p/package.json'); \
    console.log([p.version, p.engines&&p.engines.node, p.type, p.license].join(' | '))"; done
```

### Runtime dependencies — all 7 are genuinely imported

| Package | Declared | Installed | License | Own `engines.node` | ESM-only | Imported at |
|---|---|---|---|---|---|---|
| `@clack/prompts` | `^1.9.0` | 1.9.0 | MIT | `>= 20.12.0` | ESM-only | `src/cli/interactive/home.ts`, `src/cli/ui/prompts.ts`, commands |
| `boxen` | `^9.0.0` | 9.0.0 | MIT | **`>=22`** | ESM-only | `src/cli/ui/panel.ts` |
| `chalk` | `^5.4.1` | 5.6.2 | MIT | `^12.17.0 \|\| ^14.13 \|\| >=16.0.0` | ESM-only | `src/cli/ui/colors.ts` and many commands |
| `cli-table3` | `^0.6.5` | 0.6.5 | MIT | `10.* \|\| >= 12.*` | CJS (default-import interop) | `src/cli/ui/table.ts` |
| `commander` | `^13.1.0` | 13.1.0 | MIT | `>=18` | CJS (named-export interop) | `src/index.ts` |
| `strip-ansi` | `^7.2.0` | 7.2.0 | MIT | `>=12` | ESM-only | `src/cli/ui/table.ts:3` — **confirmed, keep** |
| `zod` | `^4.6.7` | 4.6.7 | MIT | *(none)* | ESM-only (dual) | `src/core/themes/schema.ts`, `src/core/profiles/schema.ts`, `src/core/config/store.ts` |

Import inventory (the grep that establishes "actually used"):

```
$ grep -rhoE "from ['\"][^'\"]+['\"]" src tests --include=*.ts | grep -vE "['\"]\.|node:" | sort -u
from "@clack/prompts"
from "boxen"
from "chalk"
from "cli-table3"
from "commander"
from "strip-ansi"
from "vitest"
from "zod"
```

(The three template-literal hits — `from "${DEFAULT_BASE_THEME_ID}"` etc. — are message
strings, not imports.)

**`strip-ansi` confirmation (G-note from the brief):** `src/cli/ui/table.ts:3` still contains
`import stripAnsi from "strip-ansi";`. It was deliberately promoted from transitive to direct
and that promotion is still correct — a direct import must be a direct dependency, or the
install breaks the moment `boxen` or `cli-table3` stops hoisting it. **Kept.**

### New files since the plan was written — checked for new dependency surface

`src/security/limits.ts`, `src/cli/errors.ts`, `src/cli/ui/feedback.ts`,
`src/cli/ui/color-mode.ts`, `src/core/themes/contrast.ts`, `src/core/themes/apply.ts`.
None introduces an external import outside the list above; `limits.ts` and `contrast.ts` are
`node:fs`/pure-math only. **No new dependency is required and none was added.**

### Dev dependencies — all 8 are used

| Package | Declared | Installed | License | Own `engines.node` | Used by |
|---|---|---|---|---|---|
| `@types/node` | `^22.10.5` | 22.20.5 | MIT | *(none)* | `npm run typecheck` / `build` — required for the `node:*` imports |
| `@typescript-eslint/eslint-plugin` | `^8.72.2` | 8.72.2 | MIT | `^18.18.0 \|\| ^20.9.0 \|\| >=21.1.0` | `eslint.config.js:2,15,18` |
| `@typescript-eslint/parser` | `^8.72.2` | 8.72.2 | MIT | same | `eslint.config.js:3,12` |
| `eslint` | `^9.18.0` | 9.39.5 | MIT | same | `npm run lint` |
| `prettier` | `^3.4.2` | 3.9.10 | MIT | `>=14` | `npm run format` |
| `tsx` | `^4.19.2` | 4.23.15 | MIT | `>=18.0.0` | `npm run dev` |
| `typescript` | `^5.7.3` | 5.9.3 | Apache-2.0 | `>=14.17` | `build`, `typecheck` |
| `vitest` | `^5.1.0` | 5.1.0 | MIT | `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` | `npm test`, `vitest.config.ts` |

**No unused declared dependency was found. Nothing was removed.** A config-file-only or
CI-only consumer counts as used — `@typescript-eslint/*` (consumed by `eslint.config.js`) and
`@types/node` (consumed by the compiler, never `import`ed) are both genuinely used, and a
naive "grep `src/` for imports" sweep would wrongly delete them.

**Nothing imported is present only transitively.** Every bare specifier in the grep above
appears in `dependencies` or `devDependencies`. Licensing: whole production tree is
MIT except `type-fest` (`MIT OR CC0-1.0`) and `@colors/colors` (MIT); `typescript` is
Apache-2.0 and dev-only. No copyleft, no unlicensed package.

### Severity: **None** — this section is clean.

---

## 3. The `overrides` block — do not remove

```json
"overrides": { "@typescript-eslint/typescript-estree": { "minimatch": "^11.0.8" } }
```

Verified that it is in force:

```
$ node -e "const l=require('./package-lock.json'); for(const k of Object.keys(l.packages)) if(k.includes('minimatch')) console.log(k,'=>',l.packages[k].version)"
node_modules/@eslint/config-array/node_modules/minimatch => 3.1.5
node_modules/@eslint/eslintrc/node_modules/minimatch => 3.1.5
node_modules/eslint/node_modules/minimatch => 3.1.5
node_modules/minimatch => 11.0.8
```

`minimatch@11.0.8` is hoisted to the top of the tree, which is what
`@typescript-eslint/typescript-estree` resolves against. This override is the only thing
holding a moderate advisory closed; `@typescript-eslint` 8.72.2 does not fix it natively, and
`npm audit fix --force` "resolves" it by **downgrading the parser to 6.15.0**, which is a
regression, not a fix. **Removable only once upstream ships a real fix.** Left untouched.

Note for whoever next regenerates the lockfile: npm does **not** record the root `overrides`
object into `package-lock.json` (`l.packages[''].overrides` → `undefined`), so the override
survives only as the already-resolved `minimatch@11.0.8` entry. Deleting the block from
`package.json` and re-resolving would silently reopen the advisory with no lockfile diff to
warn you.

---

## 4. Lockfile health — **in sync**

- `lockfileVersion`: **3**
- `package-lock.json` root (`packages[""]`) mirrors `package.json` exactly: same 7
  `dependencies` ranges, same 8 `devDependencies` ranges, same `bin`, same `license`.

**How this was determined without `npm ci`** — `npm ci` deletes `node_modules`, which would
have broken three agents editing source concurrently, so it was not run. Three independent
read-only checks instead:

1. **`npm install --package-lock-only --dry-run`** → `up to date in 4s`. This is the decisive
   one: npm re-ran full range resolution against the registry metadata and concluded the
   committed lockfile already satisfies every range in `package.json` with zero edits. A range
   the lock could not satisfy would have shown as an add/change/remove line here.
2. **`npm ls`** → exit code `0`, all 15 direct dependencies listed at their resolved versions
   with **no `invalid`, `missing`, or `extraneous` marker** on any entry. Confirms the
   *installed* tree also satisfies the declared ranges.
3. **`npm ls --omit=dev --all`** → the production tree resolves cleanly to 26 packages with no
   unmet peer or deduplication conflict.

**Residual gap, stated plainly:** these three prove *resolvability and consistency*. They do
**not** prove that a cold `npm ci` into an empty `node_modules` succeeds — tarball integrity,
platform-optional packages (`esbuild`'s per-platform binaries under `vitest`), and
postinstall behaviour are exercised only by a real clean install. **That verification is
deferred to build-release-agent's wave**, when the working tree is quiet. It is deferred, not
skipped, and nothing in this document claims it was done.

One thing a clean install will have to confront: this machine's npm has
`esbuild@0.28.2`'s postinstall **blocked** by the local `allowScripts` policy —

```
npm warn install-scripts 1 package had install scripts blocked because they are not covered by allowScripts:
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
```

The suite passes anyway, so the hoisted platform-specific `@esbuild/win32-x64` package is
evidently sufficient. On CI with default settings the script will run. **Flagged for
build-release-agent** as something to watch in the first `npm ci` run; not a defect here.

### Severity: **Low** — healthy, with one deferred verification.

---

## 5. `npm pack --dry-run` — G19 confirmed and fixed

### G19 confirmed

```
$ ls themes schemas
ls: cannot access 'themes': No such file or directory
ls: cannot access 'schemas': No such file or directory
```

Both directories listed in the old `files` array are absent from the repository. They are not
merely missing — they are **conceptually stale**:

- Built-in **themes are TypeScript code**, not data files: `src/core/themes/builtin.ts`
  exports `builtinThemes: Theme[]` as a literal array. Nothing loads a theme from a root
  `themes/` directory.
- **Schemas are Zod code**, not JSON Schema files: `src/core/themes/schema.ts`,
  `src/core/profiles/schema.ts`. `grep -rn "\"schemas\|'schemas\|/schemas" src tests` → **no
  matches at all**.
- The only runtime path that reaches outside `dist/` is
  `src/core/profiles/registry.ts:18` — `path.resolve(__dirname, "../../../profiles")`, the
  single `../../../` in the whole of `src/`.

So the correct fix is to **delete the two stale entries**, not to create the directories.

### Does `profiles/` ship? Yes — and it must

`profiles/ghost-protocol-default.json` and `profiles/monolith-default.json` both appear in the
tarball. From `dist/core/profiles/registry.js`, `../../../profiles` resolves to the installed
package root's `profiles/`. **Load-bearing: if it stopped shipping, `nightshift profile list`
would silently report zero built-in profiles** (`loadProfilesFromDir` returns `[]` on a
missing directory rather than erroring). Kept.

### Do source maps ship? They did — and they were broken

**Before the fix: 77 files = `LICENSE` + `README.md` + `package.json` + 2 profile JSON +
36 `.js` + 36 `.map`.** 54.5 kB packed / 217.0 kB unpacked.

Nearly half the tarball was source maps that **cannot resolve**:

```
$ head -c 120 dist/index.js.map
{"version":3,"file":"index.js","sourceRoot":"","sources":["../src/index.ts"],...
```

`sourcesContent` is **absent** (`tsconfig.json` sets `sourceMap: true` but not
`inlineSources`), and `src/` is **not** in `files`. So every shipped `.map` points at a
`../src/*.ts` path that does not exist in the published package. The maps are dangling: they
add ~47 % of the file count and give a debugger nothing to show. Broken maps are worse than no
maps — a tool that finds one will follow it and fail, where absent maps fall back cleanly to
the compiled line numbers.

**Fix applied:** exclude maps via a negated pattern in `files`, leaving `dist`'s `.js` and any
future non-map asset intact.

### Fix applied to `files`

```diff
   "files": [
     "dist",
-    "themes",
     "profiles",
-    "schemas"
+    "!dist/**/*.map"
   ],
```

### After the fix

```
$ npm pack --dry-run
npm notice package: nightshift-cli@0.2.0
npm notice Tarball Contents
npm notice 1.1kB LICENSE
npm notice 9.7kB README.md
npm notice 3.1kB dist/adapters/windows-terminal/apply.js
npm notice 1.0kB dist/adapters/windows-terminal/locate.js
npm notice 2.8kB dist/backup/manager.js
npm notice 1.1kB dist/banners/startup.js
npm notice 2.1kB dist/cli/commands/backup.js
npm notice 6.1kB dist/cli/commands/doctor.js
npm notice 1.1kB dist/cli/commands/init.js
npm notice 5.6kB dist/cli/commands/profile.js
npm notice 5.8kB dist/cli/commands/setup.js
npm notice 2.5kB dist/cli/commands/status.js
npm notice 8.1kB dist/cli/commands/theme.js
npm notice 3.1kB dist/cli/errors.js
npm notice 10.8kB dist/cli/interactive/home.js
npm notice 2.0kB dist/cli/ui/color-mode.js
npm notice 1.0kB dist/cli/ui/colors.js
npm notice 1.9kB dist/cli/ui/feedback.js
npm notice 1.1kB dist/cli/ui/panel.js
npm notice 1.9kB dist/cli/ui/prompts.js
npm notice 4.0kB dist/cli/ui/table.js
npm notice 445B  dist/cli/version.js
npm notice 1.2kB dist/core/capabilities/detect.js
npm notice 1.1kB dist/core/config/paths.js
npm notice 4.4kB dist/core/config/store.js
npm notice 5.1kB dist/core/profiles/manager.js
npm notice 3.4kB dist/core/profiles/registry.js
npm notice 804B  dist/core/profiles/schema.js
npm notice 4.6kB dist/core/themes/apply.js
npm notice 4.7kB dist/core/themes/builtin.js
npm notice 2.3kB dist/core/themes/contrast.js
npm notice 7.6kB dist/core/themes/manager.js
npm notice 2.1kB dist/core/themes/registry.js
npm notice 2.1kB dist/core/themes/schema.js
npm notice 5.6kB dist/index.js
npm notice 1.4kB dist/security/limits.js
npm notice 1.5kB dist/security/paths.js
npm notice 696B  dist/utils/atomicWrite.js
npm notice 1.3kB package.json
npm notice 211B  profiles/ghost-protocol-default.json
npm notice 187B  profiles/monolith-default.json
npm notice name:          nightshift-cli
npm notice version:       0.2.0
npm notice total files:   41
npm notice package size:  37.4 kB
npm notice unpacked size: 127.0 kB
```

Verified map count in the new tarball: `npm pack --dry-run | grep -c "\.map"` → **0**.

**77 → 41 files; 54.5 kB → 37.4 kB packed; 217.0 kB → 127.0 kB unpacked.** Nothing declared is
missing and nothing undeclared ships. `LICENSE`, `README.md` and `package.json` are included
by npm automatically regardless of `files`, which is correct and intended.

**Alternative for build-release-agent, if shipped maps are wanted later:** set
`"inlineSources": true` in `tsconfig.json` and drop the `!dist/**/*.map` line. That makes maps
self-contained and genuinely useful at the cost of roughly doubling the tarball. It is a
deliberate trade, not an oversight — `tsconfig.json` is not this agent's file to change.

### Severity: **Medium** (G19) — fixed in N2.

---

## 6. Cross-platform assessment

**Linux and macOS cannot be executed on this machine.** Development and every command in this
document ran on Windows 11 Pro 10.0.22631. Reasoning about a `darwin` or XDG branch is
**not** verification of it, and nothing below is labelled "tested" unless it was executed here.

Complete enumeration of platform-dependent branches, from
`grep -rn "platform\|win32\|darwin\|APPDATA\|LOCALAPPDATA\|XDG\|homedir" src --include=*.ts`:

| # | Location | Branch | Status |
|---|---|---|---|
| 1 | `src/core/config/paths.ts:7-10` | `win32` → `process.env.APPDATA ?? ~/AppData/Roaming` | **Tested.** Exercised by 7 integration test files that override `APPDATA` to a temp dir (`backup-restore`, `cli`, `error-handling`, `no-color`, `profile-apply`, `profile-import-export`, `setup`). The `??` fallback to `~/AppData/Roaming` when `APPDATA` is unset is **reasoned-about-but-untested** — no test unsets it. |
| 2 | `src/core/config/paths.ts:11-13` | `darwin` → `~/Library/Application Support/nightshift` | **Unknown.** Cannot execute macOS. Path convention is correct for macOS, but the branch has never run. |
| 3 | `src/core/config/paths.ts:14-15` | else → `XDG_CONFIG_HOME ?? ~/.config` | **Unknown.** Cannot execute Linux. Convention matches the XDG base-directory spec. Note this is the *fallthrough*, so it also catches `freebsd`, `aix`, `sunos` — never run, never tested. |
| 4 | `src/core/capabilities/detect.ts:30` | `platformSupport = win32 ? "supported" : "unsupported"` | **Tested on Windows** (`tests/unit/capabilities.test.ts` asserts `caps.platform === process.platform`). The non-Windows arm is **reasoned-about-but-untested**: the test `"never claims a platform is supported without evidence"` guards it with `if (caps.platform !== "win32")`, so on this machine that assertion **never executes**. It is a correct guard that is structurally dead on the only platform CI runs. |
| 5 | `src/core/capabilities/detect.ts:32` | `win32 ? locateWindowsTerminalSettings() : null` | **Tested on Windows**; non-Windows arm untested for the same reason as #4. |
| 6 | `src/core/capabilities/detect.ts:39` | tri-state `settingsPath ? "supported" : win32 ? "unknown" : "unsupported"` | Windows `supported` and `unknown` arms **tested** (integration tests point `LOCALAPPDATA` at a temp dir with and without a `settings.json`). `unsupported` arm **unknown**. |
| 7 | `src/core/capabilities/detect.ts:24` | `path.join(os.homedir(), ".claude", "settings.json")` | **Tested** (Windows). Platform-neutral by construction — `path.join`, not string concatenation. The comment at `:22-23` records that concatenation previously produced the mixed-separator `C:\Users\Amar/.claude/settings.json` (defect F7); using `path.join` is the right fix and generalises correctly to POSIX. |
| 8 | `src/adapters/windows-terminal/locate.ts:18` | `process.env.LOCALAPPDATA`, returns `null` if unset | **Tested.** Integration tests set `LOCALAPPDATA` to a temp dir; `cli.test.ts:112` constructs the env explicitly. Degrades to `null` (not a throw) off-Windows where the variable is absent — correct, and that specific degradation is **reasoned-about-but-untested**. |
| 9 | `src/adapters/windows-terminal/locate.ts:11-15,22` | three candidate suffixes (Store-packaged, Preview, unpackaged), joined via `path.join(localAppData, ...suffix.split("/"))` | **Partially tested.** The unpackaged `Microsoft/WindowsTerminal/settings.json` path is what integration tests create. The two Store `Packages/...LocalState` paths are **reasoned-about-but-untested** — they are documented real install locations but no test or dev machine exercised them. The `split("/")` + `path.join` construction is the right way to keep the literals readable while emitting native separators. |
| 10 | `src/cli/commands/status.ts:26` | displays `os.platform()` / `os.release()` | **Tested** (Windows). Display only. |
| 11 | `src/cli/commands/doctor.ts:72-84` | warns when `platformSupport !== "supported"`, message names Windows 11 as the initial target | **Tested on Windows** for the `ok` arm; the `warn` arm is **unknown**. |
| 12 | `src/cli/commands/setup.ts:36,50,74` | surfaces `caps.platform` in the setup proposal | **Tested** (Windows). Display only. |
| 13 | Path separators generally | every filesystem path in `src/` is built with `path.join` / `path.resolve`; zero manual `"\\"` or `"/"` concatenation | **Tested** on Windows; construction is platform-correct by design. |

### Is the `darwin` / XDG code in `paths.ts` dead code, forward-looking, or a false implication?

It is **forward-looking code that currently carries a mild false implication, and is not dead.**

- **Not dead.** `getNightshiftRoot()` is called unconditionally by `getConfigFilePath()`,
  `getUserThemesDir()`, `getBackupsDir()`, `getUserProfilesDir()`. On a Mac or Linux box those
  branches *would* execute and return a sane, convention-correct path.
- **Forward-looking and cheap.** Nine lines, no dependency, no abstraction, and it follows the
  platform conventions a future adapter would need anyway. Deleting it would buy nothing and
  would have to be rewritten verbatim later. It should stay.
- **The false implication is real but small, and it is a *documentation* risk, not a code
  defect.** A reader of `paths.ts` alone could conclude macOS and Linux are supported. In
  practice they are safely corralled: `detectCapabilities()` returns `platformSupport:
  "unsupported"` off-Windows (`detect.ts:30`), `doctor` prints
  `"<platform> adapters are not implemented yet (Windows 11 is the initial target)"`
  (`doctor.ts:76`), and `docs/PLATFORM-COMPATIBILITY.md` lists Linux/macOS as
  "Not implemented". So the product never *claims* support; only this one file reads as if it
  might. The net effect on a non-Windows user is a config directory created in the right place
  and an honest "unsupported" from every command that matters.

**Recommendation (Low):** add one comment line to `src/core/config/paths.ts` noting that the
`darwin`/XDG branches are deliberate forward-looking convention support and that platform
*support* is decided solely by `detectCapabilities()`. **Not applied here** — `src/**` is
owned by other agents this wave. Handed to documentation-agent / core-cli-agent.

### Severity: **Low** — the gap is test coverage and one comment, not behaviour.

---

## 7. CI implications — for build-release-agent, not changed here

`.github/workflows/ci.yml` is owned by build-release-agent (G20, G23). This agent reached
conclusions about it and **did not edit it.** Current state:

```yaml
runs-on: windows-latest
node-version: "20"
- run: npm install
```

| Problem | Why it matters now |
|---|---|
| **`node-version: "20"` is below the new floor — this is the urgent one.** | After Wave A, `vitest@5.1.0` declares `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` and `boxen@9.0.0` declares `>=22`. CI on Node 20 installs with `EBADENGINE` warnings and runs the suite on a version vitest does not support. **This was not reproduced on this machine** — only `node v26.12.1` is installed here, so "CI is broken on 20" is a **prediction from the declared engines, not an observed failure.** Either way the matrix must move. |
| `npm install`, not `npm ci` (G20) | The committed lockfile is not enforced; transitive drift would pass CI silently. Combined with §3, this is sharper than it looks: the `minimatch` override lives only in the lockfile's resolved tree, so an unenforced lockfile means the moderate advisory could reopen without CI noticing. |
| Single Node version (G21) | The advertised floor is never tested. |

Requested matrix: **`22.12.0` and `24` (and optionally `26`) on `windows-latest`, all
blocking.** Keep `windows-latest` as the only OS. Per `ROADMAP_STATUS.md`, Linux and macOS are
not supported, and adding them to CI — even as informational jobs — would imply support that
`docs/PLATFORM-COMPATIBILITY.md` explicitly disclaims. Pin the low rail to `22.12.0` exactly,
not `22`, so the job actually tests the declared floor rather than whatever 22.x is current.

---

## 8. Findings summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `engines.node: ">=18.0.0"` was false; real floor is 22 (`boxen`/`slice-ansi` `>=22`), testable floor 22.12.0 (`vitest@5`) | **High** | **Fixed** — `>=22.12.0` |
| 2 | `files` listed non-existent `themes` and `schemas` (G19) | Medium | **Fixed** — removed |
| 3 | 36 dangling `.map` files shipped, pointing at an unshipped `src/` | Medium | **Fixed** — `!dist/**/*.map`; 77 → 41 files |
| 4 | CI Node 20 is below the post-Wave-A floor | **High** | **Handed to build-release-agent** |
| 5 | CI uses `npm install`, lockfile unenforced (G20) — compounded by the lockfile-only `minimatch` override | Medium | **Handed to build-release-agent** |
| 6 | `README.md` Requirements says "Node.js >= 18" | Medium | **Handed to documentation-agent** |
| 7 | `darwin`/XDG branches in `paths.ts` are untested and read as implied support | Low | Comment recommended; `src/**` not this agent's to edit |
| 8 | Non-Windows arms of `detect.ts` are structurally unreachable in CI, so their guard tests never execute | Low | Open; needs a mocked-`os.platform()` test (qa-testing-agent) |
| 9 | Clean `npm ci` from an empty `node_modules` not verified | Low | **Deferred** to build-release-agent's wave — `npm ci` deletes `node_modules` and three agents were editing source concurrently |
| 10 | `esbuild` postinstall blocked by local `allowScripts`; behaves differently on CI | Info | Watch on first `npm ci` |
| 11 | No unused dependency; nothing imported only transitively; `strip-ansi` promotion still correct | — | Clean, no action |

## 9. Security posture

```
$ npm audit
found 0 vulnerabilities
```

Re-confirmed **after** the `package.json` edits and the `--package-lock-only` refresh. All
Wave A versions (`zod` 4.6.7, `vitest` 5.1.0, `@typescript-eslint/*` 8.72.2) and the
`overrides` block are intact. No dependency was added; no version was changed by this agent.
