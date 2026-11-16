# Build, packaging, and release audit

Owner: build-release-agent. Tasks B1 (audit) and B2 (fixes).
Environment every command below ran in: **Windows 11 Pro 10.0.22631**, `node v26.12.1`,
`npm 12.2.1`, repo `D:\CTP`, branch `feat/nightshift-1.0.0`, Git Bash.

Every claim here traces to a command recorded in this document. Where something could not be
executed on this machine it is labelled **unverified** rather than asserted.

---

## 1. Clean build from scratch — passes

This is the verification `dependency-compat-agent` explicitly deferred (DEPENDENCY_AUDIT.md §4,
finding #9): it could not run `npm ci` because that deletes `node_modules` while three agents
were editing source. The tree was quiet for this wave, so it was run for real.

```
$ rm -rf dist && npm ci
npm warn deprecated eslint@9.39.5: This version is no longer supported.
added 184 packages, and audited 185 packages in 21s
64 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 1 package had install scripts blocked because they are not covered by allowScripts:
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
NPM_CI_EXIT=0
```

**Cold `npm ci` into an empty `node_modules` succeeds.** Tarball integrity is fine, the
platform-optional `esbuild` binaries resolve, and `npm audit` is still **0 vulnerabilities**
*after* the cold install — so the `minimatch@11.0.8` resolution that holds the moderate
advisory closed survives a full re-install from the committed lockfile. That was the specific
risk §3 of DEPENDENCY_AUDIT.md flagged (npm does not write the root `overrides` object into
`package-lock.json`); it is now verified rather than assumed.

The `esbuild@0.28.2` postinstall block is confirmed as **harmless on this machine**: the suite
runs 268/268 without it, because the hoisted `@esbuild/win32-x64` package supplies the binary
that `install.js` would otherwise download. On CI with default settings the script will run,
which is a superset of what was tested here, not a different configuration.

```
$ npm run build
BUILD_EXIT=0
$ node dist/index.js --version
0.2.0
$ find dist -name '*.js' | wc -l
36
$ head -1 dist/index.js
#!/usr/bin/env node
```

`dist/` is gitignored (`.gitignore:2`), so the build output is never committed and an
install-from-tarball consumer depends entirely on `dist/` being produced before `npm pack` —
which is what the new `prepublishOnly` guard exists to enforce (§5).

---

## 2. Install from tarball — the headline check, and it passes

Never performed in this project's history. It is the only test that proves the *published
artifact* works rather than the repo working.

```
$ PKGDIR=$(mktemp -d); TARBALL=$(npm pack --pack-destination "$PKGDIR" | tail -1)
$ TESTDIR=$(mktemp -d); cd "$TESTDIR" && npm init -y >/dev/null
$ npm install "$PKGDIR/$TARBALL"
16 packages are looking for funding
found 0 vulnerabilities

$ node node_modules/nightshift-terminal/dist/index.js --version
0.2.0
EXIT=0

$ ./node_modules/.bin/nightshift --version
0.2.0
EXIT=0
```

The installed tarball pulls 16 packages (the 7 runtime dependencies plus their transitives) and
reports **0 vulnerabilities** as an installed consumer would see it.

### 2.1 G24 — runtime version resolution from inside an installed package: **works**

`src/cli/version.ts` resolves `path.resolve(__dirname, "../../package.json")`. The classic
failure mode is that this is written against the *repo* layout and breaks once the package sits
under `node_modules`. It does not break here, and the arithmetic is worth recording so nobody
"fixes" it later:

- Compiled location: `<pkg>/dist/cli/version.js` (`rootDir: src`, so `src/cli/version.ts` →
  `dist/cli/version.js`).
- `__dirname` = `<pkg>/dist/cli`; `../../package.json` = `<pkg>/package.json`.
- In the repo that is `D:\CTP\package.json`; in an install it is
  `<testdir>/node_modules/nightshift-terminal/package.json`. **Both are the package's own manifest.**

`package.json` is included in the tarball by npm unconditionally regardless of `files`, so the
file this depends on can never be excluded by a `files` edit. The two-level climb is load-bearing
on `rootDir: src` staying as it is — if `dist/` ever gained a level, this breaks silently with a
`MODULE_NOT_FOUND`-shaped crash on *every* command, because `version` is a module-level `const`.
**No fix needed. No change made.**

### 2.2 Commands run from inside the installed package

Run with `APPDATA` and `LOCALAPPDATA` pointed at `mktemp -d` scratch directories.
`theme apply`, `profile apply` and `setup --yes` were **deliberately not run**: they write the
real Windows Terminal `settings.json`, whose location comes from `LOCALAPPDATA` but whose
*effect* is on the developer's actual terminal. Their logic is covered by the integration suite.

| Command | Result |
|---|---|
| `--version` | `0.2.0`, exit 0 |
| `--help` | full command list rendered: `init`, `status`, `setup`, `theme`, `profile`, `doctor`, `backup`, `restore`, plus `--no-color`. Exit 0 |
| `theme list` | all 4 built-in themes in a bordered table with color swatches. Exit 0 |
| `status` | themed panel + capability table; `Windows Terminal: not detected` (correct — `LOCALAPPDATA` was a scratch dir), `Config: not initialized`. Exit 0 |
| `profile list` | **both bundled profiles listed** — this is the check that proves `profiles/` ships *and* that `dist/core/profiles/registry.js`'s `../../../profiles` resolves to the installed package root. A broken `files` array here would have silently shown an empty list, not an error. Exit 0 |
| `theme validate <valid file>` | `✓ "Tarball Probe" (tarball-probe) is a valid theme.` Exit **0** |
| `theme validate <invalid file>` | `✗ ... is not a valid theme (4 issues).` + per-field list + `→` hint. Exit **1** |
| `theme validate <missing file>` under `NO_COLOR=1` | `✗ No file found at ...` + `→` hint. Exit **1**, and the `✗` glyph survives with color stripped |

The exit-code contract behaves as documented on the installed artifact: `0` success, `1`
runtime/usage failure, `2` corrupt config (§4.1).

### 2.3 Tarball contents

```
$ npm pack --dry-run | grep -E "total files|package size|unpacked size"
npm notice total files:   41
npm notice package size:  39.9 kB
npm notice unpacked size: 134.2 kB
$ npm pack --dry-run | grep -c "\.map"
0
```

41 files: `LICENSE`, `README.md`, `package.json`, 2 profile JSON, 36 `.js`. Zero source maps,
zero tests, zero `src/`. This confirms `dependency-compat-agent`'s `files` fix
(`["dist","profiles","!dist/**/*.map"]`) from the consumer side — the 36 dangling `.map` files
that pointed at an unshipped `src/` are gone, and nothing load-bearing went with them.

Nothing is missing and nothing extraneous ships. The size grew 37.4 kB → 39.9 kB against
DEPENDENCY_AUDIT.md §5 purely because this wave added code (the `reportConfigCorrupt` helper and
Prettier reflow); the file count is unchanged at 41.

### 2.4 Shebang and the Windows `bin` shim

```
$ head -1 dist/index.js
#!/usr/bin/env node
$ ls node_modules/.bin/ | grep -i night
nightshift
nightshift.cmd
nightshift.ps1
```

The shebang survives `tsc` into `dist/index.js` (TypeScript preserves a leading comment line,
and the shebang is the first line of `src/index.ts`).

**The executable bit is a non-issue on Windows and a non-issue on POSIX for a different reason.**
npm sets the executable bit on `bin` targets at install time; it does not rely on the mode
recorded in the tarball. On Windows npm instead generates the three shims above — `.cmd` for
`cmd.exe`, `.ps1` for PowerShell, and the extensionless `sh` script for Git Bash / MSYS. All
three were produced. The Git Bash shim was executed directly (`./node_modules/.bin/nightshift
--version` → `0.2.0`), which exercises the shebang path end to end.

**Unverified:** the POSIX executable bit, because no Linux or macOS machine is available here.
Given `ROADMAP_STATUS.md` and `docs/PLATFORM-COMPATIBILITY.md` list those platforms as not
implemented, this is consistent with the product's stated support, not a gap in it.

---

## 3. CI workflow — was broken for the new engines floor

### 3.1 The urgent defect (G21), handed over by dependency-compat-agent

Before this wave:

```yaml
runs-on: windows-latest
node-version: "20"
- run: npm install
```

`engines.node` is now `>=22.12.0`. **Node 20 is below the floor**, so CI would install with
`EBADENGINE` warnings and then run the suite on a Node version `vitest@5.1.0` does not support
(`^22.12.0 || ^24.0.0 || >=26.0.0`). Stated honestly: this was **not reproduced** — only
`node v26.12.1` is installed on this machine, so "CI is broken on 20" is a conclusion from the
declared engines, matching DEPENDENCY_AUDIT.md §7's own qualifier. The matrix had to move either
way.

### 3.2 Gaps found, and what each one actually risked

| # | Gap | Risk | Status |
|---|---|---|---|
| G21 | `node-version: "20"`, single version, below the floor | suite runs on an unsupported Node; declared floor never tested | **Fixed** — matrix `22.12.0`, `24`, `26` |
| G20 | `npm install`, not `npm ci` | lockfile unenforced. Sharper than it looks: the `minimatch@11.0.8` override lives only as a resolved lockfile entry, never as an `overrides` object, so an unenforced lockfile can silently reopen a moderate advisory with no diff to warn you | **Fixed** — `npm ci` |
| G23 | no format check | `npm run format` only *writes*. Nothing stopped unformatted code landing — and 32 files were in fact unformatted when this audit started (§4.2) | **Fixed** — `format:check` script + CI step |
| — | no audit step | a newly disclosed advisory in a pinned transitive would never fail a build | **Fixed** — `npm audit --audit-level=moderate` |
| — | no dependency cache | slower, not incorrect | **Fixed** — `cache: npm` |

### 3.3 OS matrix: `windows-latest` only, on purpose

Not an oversight and deliberately left alone. `docs/PLATFORM-COMPATIBILITY.md` lists Linux and
macOS as "Not implemented" and `ROADMAP_STATUS.md` agrees. Adding them to CI — **even as
non-blocking informational jobs** — would advertise support the product explicitly disclaims,
and a green Ubuntu badge is a support claim whatever the job is labelled. A comment in the
workflow records this so a future contributor does not "fix" it.

The low rail is pinned to `22.12.0` exactly rather than `22` so the job tests the *declared
floor* rather than whatever 22.x is current when CI happens to run. `fail-fast: false` so one
Node version failing still reports the others.

---

## 4. Findings fixed in this wave

### 4.1 Three config-corrupt advisories lost the `✗` glyph under `NO_COLOR`

Handed over by the orchestration monitor (MONITOR_REPORT.md §3.1). `src/cli/commands/theme.ts`,
`status.ts`, and `profile.ts` each printed the degraded-reader advisory as
`console.error(chalk.red(message))` + `process.exitCode = EXIT_CONFIG_CORRUPT`, bypassing
`errorMessage()` from `src/cli/ui/feedback.ts`.

Under `NO_COLOR` or a piped stream, `chalk.red` emits nothing, so the advisory arrived as an
undistinguished line of text on stderr — **the exact failure mode the `✗` glyph was introduced
to prevent.**

Fixed at the root rather than three times over: the identical three-line block became one
exported `reportConfigCorrupt(error)` in `src/cli/errors.ts` (which already imports
`errorMessage` for `reportFatal`, so no new import graph). `failWith()` was not reusable here —
it hardcodes exit 1, and this path must exit 2.

Verified from inside the installed tarball with a deliberately corrupted `config.json`:

```
$ NO_COLOR=1 APPDATA=<scratch> ./node_modules/.bin/nightshift theme list 2>&1 >/dev/null
✗ NIGHTSHIFT's configuration file could not be read: ...\nightshift\config.json
  Expected property name or '}' in JSON at position 2 (line 1 column 3)
  Fix the file by hand, or delete it and run `nightshift init` to recreate it.
  → Output above is incomplete: anything read from the config (active theme, active profile) is shown as unset.
REAL_EXIT=2
```

Glyph present with color off, `→` hint convention kept, table still rendered on stdout, exit
code 2 intact. The hint deliberately does **not** repeat the remedy — `ConfigCorruptError`'s
message already carries "fix it or delete it and re-init", and a `→` line that echoes the line
above it is how hints stop being read.

### 4.2 32 of 56 source files were unformatted (G23)

```
$ npx prettier --check "src/**/*.ts" "tests/**/*.ts"
[warn] Code style issues found in 32 files. Run Prettier with --write to fix.
```

Not confined to this cycle's new files. The unformatted set spans new files
(`setup.ts`, `theme-authoring.test.ts`, `table-width.test.ts`, `theme-manager.test.ts`,
`contrast.test.ts` …), files this cycle modified (`index.ts`, `store.ts`, `table.ts`,
`manager.ts` …), and files untouched for several commits (`paths.ts`, `cli.test.ts`,
`path-traversal.test.ts`, `capabilities.test.ts`). **This is precisely the accumulation G23
predicted**: with `format` write-only and no check in CI, drift is invisible until someone looks.

`npm run format` was run once across the whole tree, so `format:check` is now a gate that can
only be entered green rather than one that fails on arrival. The diff is whitespace and line
reflow only — no logic changed, and the 268-test suite is unchanged by it.

---

## 5. `package.json` changes

```diff
   "format": "prettier --write \"src/**/*.ts\" \"tests/**/*.ts\"",
+  "format:check": "prettier --check \"src/**/*.ts\" \"tests/**/*.ts\"",
+  "clean": "node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\"",
+  "prepublishOnly": "npm run clean && npm run format:check && npm run typecheck && npm run lint && npm run build && npm test"
```

- **`prepublishOnly` (G22)** closes the hole that mattered most for a first publish: `dist/` is
  gitignored, so a publish from a fresh clone with no build, or a clone whose `dist/` is stale
  relative to `src/`, would ship a wrong or empty package. `clean` runs *first* so the build
  cannot be satisfied by leftover output. npm runs `prepublishOnly` only on `npm publish`, never
  on `npm install` or `npm pack`, so it costs a developer nothing day to day.
- **No automatic publish step was added**, and none should be. Publishing is irreversible
  (npm unpublish is heavily restricted after 72 hours) and externally consequential. It requires
  a human. See RELEASE_CHECKLIST.md.
- **`clean` uses `node -e` with `require('node:fs')`, not `rm -rf`.** npm scripts run under
  `cmd.exe` on Windows, where `rm -rf` does not exist; `node -e` is the only portable form
  available without adding a dependency (`rimraf` would be a new dependency for one line). The
  `require` form rather than a bare `fs` global because builtin globals in `--eval` are not
  stable across the Node range in the matrix — `-e` defaults to CommonJS even under
  `"type": "module"`, so `require` is available on every version in `engines`. Verified on
  `v26.12.1`; **unverified on 22.12.0 and 24**, which the new CI matrix will settle on first run.

---

## 6. Release readiness

| Area | State | Verdict |
|---|---|---|
| Version | `0.2.0`, never published. npm name `nightshift-cli` **unverified as available** — not checked, since checking registry availability is harmless but claiming it without checking is not | **Resolved, badly: the name was NOT available.** `nightshift-cli@0.2.0` is an unrelated published package by a different author, which also declares `bin: nightshift`. Renamed to `nightshift-terminal` (#39) |
| Versioning scheme | SemVer, pre-1.0. Under 0.x a minor bump may carry breaking changes, which is correct for a tool whose config schema is still `"1.0"` and whose command surface is still growing | Sound |
| Changelog | `CHANGELOG.md` exists. This wave's work is **not yet in it** — it is a large unreleased change set, and whether it is `0.3.0` or `1.0.0` is `planner-architect`'s call, not this agent's | **Open, blocking a release** |
| Tagging | **No tags exist** (`git tag` → empty). No convention established | Needs a decision; `v0.2.0` style is proposed in RELEASE_CHECKLIST.md |
| `files` / tarball | Verified correct from the consumer side (§2) | Ready |
| Build reproducibility | Cold `npm ci` + `npm run build` verified (§1) | Ready |
| Publish guard | `prepublishOnly` added (§5) | Ready |
| `repository` / `bugs` / `homepage` fields | **Absent from `package.json`.** npm renders the repo link, issue link and homepage on the package page from these; without them a published page has no route back to the source | **Open** — not added here because `package.json` metadata beyond scripts is not this agent's call and the canonical URLs should be the maintainer's |
| 2FA / provenance | Not configured. `--provenance` requires publishing from CI with OIDC, which would mean an automated publish path — explicitly out of scope | Human decision |
| Node floor honesty | `engines.node: ">=22.12.0"` now matches reality and CI tests it (§3) | Ready |

### What a first publish would require, beyond what is now in place

1. A human decision on the version number for this change set, and a `CHANGELOG.md` entry.
2. `repository`, `bugs`, and `homepage` in `package.json`.
3. ~~Confirmation that `nightshift-cli` is available on the npm registry.~~ **Checked: it is not.** Taken by an unrelated project; renamed to `nightshift-terminal` (#39).
4. An npm account with publish rights and 2FA, authenticated locally.
5. A human running `npm publish`. Nothing in this repo does it automatically, by design.

---

## 7. What remains unverified

Stated plainly rather than papered over:

- **Node 22.12.0 and 24.** Only `v26.12.1` exists on this machine. The matrix is correct against
  the declared `engines`, but the first CI run is what actually proves the suite passes on the
  floor. This includes the `clean` script's `node -e` form.
- **The POSIX executable bit** on the packed `bin` target (§2.4). No Linux/macOS machine; also
  outside the product's stated support.
- **Interactive TTY behaviour.** `theme apply`, `profile apply` and `setup --yes` were not run
  from the tarball because they write the developer's real Windows Terminal settings, and the
  arrow-key interactive menu cannot be driven from a non-TTY tool at all. Both are covered by
  the integration suite's non-interactive paths; neither is covered by automation end to end.
- **`npm publish` itself.** Never run. `prepublishOnly` is verified only by inspection of its
  component scripts, each of which passes individually — npm does not run it for `npm pack`.
- **Registry availability of the package name.**

---

## 8. Final gate, after every change in this wave

```
$ npm run typecheck   → exit 0
$ npm run lint        → exit 0 (0 errors, 0 warnings)
$ npm run format:check→ All matched files use Prettier code style!
$ npm run build       → exit 0
$ npm test            → Test Files 25 passed (25) · Tests 268 passed (268)
$ npm audit           → found 0 vulnerabilities
$ node dist/index.js --version → 0.2.0
```

Re-verified after the changes: clean build from a removed `dist/`, fresh `npm pack`, fresh
install into a new scratch directory, `--version` via both `node dist/index.js` and the
generated `.bin` shim. All temp directories and the `.tgz` files were created under `mktemp -d`
and removed; no tarball remains in `D:\CTP`.
