# NIGHTSHIFT security audit (task S1)

Audited 2026-11-15 against commit `813c7c9` (branch `feat/nightshift-1.0.0`), NIGHTSHIFT
0.2.0. Baseline: typecheck/lint/build pass, `npm test` 73/73 pass, `npm audit` 10 findings
(7 moderate, 1 high, 2 critical).

Threat model reminder: NIGHTSHIFT is a local CLI with **no network calls and no
child-process execution**. The attacker is *untrusted data on disk* — a hostile theme or
profile JSON file, a hostile path string passed on the command line, or a weird/hostile
Windows Terminal `settings.json`. There is no privilege boundary between the CLI and the
user it runs as: both own the same files. That distinction decides the severity of several
findings below.

---

## 1. Filesystem call sites

Every `fs.*` and `path.join` site in `src/`, classified by whether the path is derived from
untrusted input and whether it routes through `src/security/paths.ts`.

| # | Site | Path origin | Guard | Verdict |
|---|---|---|---|---|
| 1 | `src/core/config/paths.ts:8-31` | `process.env.APPDATA` / `XDG_CONFIG_HOME` / `os.homedir()` + fixed literals | none needed | **OK.** Env vars are same-trust-level as the process; nothing user-supplied is appended. |
| 2 | `src/core/config/store.ts:25,30,33` | `getConfigFilePath()` — fully derived | n/a | **OK** for traversal. Zod-validated after parse (§2). No size cap (see F-3). |
| 3 | `src/core/themes/registry.ts:15-22` | `fs.readdirSync(dir)` entries | `resolveSafePath(dir, fileName)` :20 | **OK.** `readdirSync` cannot return a `..` segment, so the guard is belt-and-braces, but correct. No size cap (see F-3). |
| 4 | `src/core/profiles/registry.ts:21-28, 73, 86-93` | `readdirSync` entries, and `id` from CLI at :73 | `resolveSafePath` :26, :73, :91 | **OK.** `userProfileFileExists(id)` is the one that matters: `id` comes straight from `profile remove <id>` / import, and it is contained. |
| 5 | `src/core/profiles/manager.ts:25,29,45` (import source) | **CLI arg**, `path.resolve(process.cwd(), sourcePath)` | *deliberately unguarded* | **OK by design.** Import is supposed to read an arbitrary path the user names; containing it to a base dir would break the feature. Reads only, with a size cap and `isFile()` check. |
| 6 | `src/core/profiles/manager.ts:69, 80-81` (import dest) | `${profile.id}.json`, `id` from the **file contents** | `resolveSafePath` :69 + `assertNotSymlink` :79 | **OK.** This is the real traversal sink — a hostile file claiming `"id": "../../../.ssh/authorized_keys"` — and it is guarded twice: the `id` regex `/^[a-z0-9-]+$/` (schema) rejects `.` and `/` outright, then `resolveSafePath` contains it. |
| 7 | `src/core/profiles/manager.ts:103-114` (export dest) | **CLI arg** `--output` | `assertNotSymlink` :113 + existence check :105 | **OK by design**, same reasoning as #5. Will not clobber without `--overwrite`, will not follow a symlink. |
| 8 | `src/core/profiles/manager.ts:130-131` (`unlinkSync`) | **CLI arg** `id` | `resolveSafePath` :130, plus `userProfileFileExists` and `isBuiltinProfileId` pre-checks | **OK.** The only unlink in the codebase and it is contained. |
| 9 | `src/backup/manager.ts:25-31, 40` (create) | generated `id` (`Date.now()` + UUID) | `resolveSafePath` :25 | **OK.** Id is not attacker-influenced. |
| 10 | `src/backup/manager.ts:49-53` (list) | `readdirSync` entries | `path.join`, no `resolveSafePath` | **OK** — same `readdirSync` reasoning as #3. Metadata is cast, not validated (see F-2b). |
| 11 | `src/backup/manager.ts:65-80` (restore) | **CLI arg** `backupId` | `resolveSafePath` :65 | **OK for reading the backup.** But the *write* target at :80 is `metadata.originalPath`, read out of a JSON file — see **F-1**. |
| 12 | `src/utils/atomicWrite.ts:12-15` | caller-supplied target | none (by design; callers guard) | See **F-4** (symlink/TOCTOU). |
| 13 | `src/adapters/windows-terminal/locate.ts:22-23` | `process.env.LOCALAPPDATA` + fixed literals | none needed | **OK.** |
| 14 | `src/adapters/windows-terminal/apply.ts:91` | `locateWindowsTerminalSettings()` result | n/a | **OK** for traversal. No size cap (see F-3). |
| 15 | `src/core/capabilities/detect.ts:21-22` | `os.homedir()` + literal | none needed | **OK.** Read-only `existsSync` probe. |
| 16 | `src/cli/version.ts:8-10` | `__dirname` + literal | none needed | **OK.** Reads the package's own `package.json`. |

**Conclusion:** no unguarded traversal sink. Every place where a *user-controlled string
becomes a path under a NIGHTSHIFT-owned directory* routes through `resolveSafePath`. The two
unguarded paths (#5, #7) are the import source and export destination, where accepting an
arbitrary path is the feature.

### F-1 — `restoreBackup()` writes to a path taken from JSON (Medium, robustness-leaning)

`src/backup/manager.ts:71-80`:

```ts
const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as BackupMetadata;
...
atomicWriteFileSync(metadata.originalPath, content);
```

`originalPath` is an unvalidated `as` cast from a JSON file, then used directly as a write
destination with no `resolveSafePath` (correctly — it is an absolute path outside
NIGHTSHIFT's root by nature) and **no `assertNotSymlink`**.

Scenario: an attacker who can write to `%APPDATA%\nightshift\backups\<id>\metadata.json`
edits `originalPath` to `C:\Users\me\.ssh\authorized_keys` and `snapshot.json` to their key.
`nightshift backup restore <id>` then writes it.

Real severity: **low, because of who the attacker must already be.** Writing to
`%APPDATA%\nightshift\` requires the user's own privileges, at which point the attacker can
write `authorized_keys` directly. This is a *confused-deputy* shape with no privilege gain.
It stays on the list because `originalPath` is also missing a type check entirely —
`undefined` or a number there crashes with an unhelpful `ERR_INVALID_ARG_TYPE` instead of
"corrupted backup metadata". Recommended fix: validate `BackupMetadata` with Zod and add
`assertNotSymlink(metadata.originalPath)`. **Deferred to D2/Q2** — not fixed in S2, which
prioritises the runtime advisory; see "Not remediated" below.

---

## 2. External-data parses

| Parse site | Validation | Verdict |
|---|---|---|
| User theme JSON — `src/core/themes/registry.ts:22-23` | `safeParseTheme` (Zod), failures skipped | **Validated.** |
| Bundled + user profile JSON — `src/core/profiles/registry.ts:28-29, 93-94` | `safeParseProfile` (Zod **strict**) | **Validated.** |
| Imported profile — `src/core/profiles/manager.ts:50` | `safeParseProfile` (strict) | **Validated**, plus size cap, `isFile()`, theme-exists and built-in-id checks. |
| `config.json` — `src/core/config/store.ts:33-34` | `configSchema.parse` (throws on invalid) | **Validated.** Note `.parse` not `.safeParse`: a corrupt config is a hard crash with a raw `ZodError`, not a friendly message. Ugly, not insecure. (G17 territory.) |
| `package.json` — `src/cli/version.ts:10` | `as { version: string }` | **Cast.** Own shipped artifact, not external data. Acceptable. |
| Backup `metadata.json` — `src/backup/manager.ts:53, 71` | `as BackupMetadata` | **Cast.** See F-1 / F-2b. |
| Windows Terminal `settings.json` — `src/adapters/windows-terminal/apply.ts:92-96` | root-shape check only, then cast | **Cast.** See F-2a. |

### F-2a — `readWindowsTerminalSettings()` / `mergeThemeIntoSettings()` casts (Low, **robustness, not a privilege boundary**) — gap G7

`readWindowsTerminalSettings()` (`apply.ts:90-97`) does check the root is a non-null,
non-array object, then casts to `Record<string, unknown>`. That is the right level of
validation for this file: NIGHTSHIFT must **preserve every unrelated key** it does not
understand, so a schema that rejects unknown keys would be actively wrong here, and
`Record<string, unknown>` is an honest type for "object whose keys we mostly don't know".

The real defect is one line down, in `mergeThemeIntoSettings()` (`apply.ts:51-54`):

```ts
const existingSchemes = Array.isArray(settings.schemes)
  ? (settings.schemes as WindowsTerminalColorScheme[])
  : [];
const withoutSameName = existingSchemes.filter((s) => s?.name !== scheme.name);
```

`Array.isArray` guards the container but **nothing validates the elements** — the cast
asserts every element is a `WindowsTerminalColorScheme` when nothing has checked that.

**I tested this before claiming it was a bug, and it is not an exploitable one.** I wrote 12
hostile-shape cases (`schemes` as `null`/string/number/object/boolean; elements of
`[null, "Campbell", 42, [], undefined, {nested:{}}]`; a `name` that is an array) and ran them
against the *pre-fix* implementation: **all 12 passed.** The `s?.name` optional chain is
load-bearing and sufficient — for every value `JSON.parse` can produce (`null`, boolean,
number, string, array, object) `s?.name` yields `undefined` rather than throwing, so the
element simply does not match and is passed through. There is no crash and no corruption
beyond what was already in the file.

So the honest finding is narrower than "unvalidated cast → corruption":

- **It is a type lie, and type lies invite future crashes.** With `settings.schemes` cast to
  `WindowsTerminalColorScheme[]`, TypeScript will happily accept a future edit like
  `existingSchemes.filter((s) => s.name.toLowerCase() !== ...)` or any read of
  `s.background` — which *would* throw on a `null` element, during a `theme apply` that has
  already taken a backup. The compiler is currently guaranteeing something false.
- **The crash-safety was accidental, and nothing tested it.** Drop the `?.` in a refactor
  and `theme apply` throws on any `settings.json` with a `null` in `schemes`.

**This is a robustness issue, not a privilege boundary.** `settings.json` is owned by the
same user running NIGHTSHIFT, it is never executed, and no value from it flows into a path,
a command, or any sink. Nobody gains anything.

**Fixed in S2 (d)**, as type honesty plus regression coverage rather than as a bug fix:
`unknown[]` instead of the cast, an explicit `isSchemeNamed()` predicate, and the 12 cases
kept as tests so the behavior is now asserted instead of accidental.

### F-2c — `profiles` as a legacy array is silently mangled (Low, **not remediated**)

`apply.ts:71-74` treats `settings.profiles` as an object whenever
`typeof === "object" && !== null`, which **includes arrays**. Windows Terminal historically
accepted `profiles` as a bare array of profiles. Given `profiles: [{...}, {...}]`, the
spread at `apply.ts:83-86` produces `{ "0": {...}, "1": {...}, defaults: {...} }` — the
array-ness is lost and Windows Terminal no longer sees a profile list.

Not fixed here, deliberately: the three candidate behaviors are (a) mangle as today,
(b) drop the array, losing more, or (c) refuse to apply and tell the user. (c) is correct and
is a **UX/error-path decision** that changes command output, which S2 is scoped out of
(`src/cli/commands/*` output formatting belongs to other agents). Filed for D2 with a
recommendation of (c). Note this is pre-existing and unrelated to the Zod upgrade.

### F-2b — backup `metadata.json` cast (Low)

`src/backup/manager.ts:53` casts in `listBackups()`. A corrupt entry is caught by the
surrounding `try`/`catch` only if `JSON.parse` throws; valid JSON of the wrong shape passes
through and surfaces as `undefined` in the `backup list` table. Cosmetic. Same Zod fix as
F-1 would cover it. Not remediated in S2.

---

## 3. Resource exhaustion — gap G9

Only one read in the codebase has a size cap:

- `src/core/profiles/manager.ts:12, 36-41` — `MAX_IMPORT_BYTES = 64 * 1024`, enforced via
  `statSync().size` **before** `readFileSync`, which is the correct order (it never
  allocates the string).

Everything else is uncapped:

| Read | Site | Trigger |
|---|---|---|
| User theme files | `themes/registry.ts:22` | `theme list`, `theme show`, `theme apply`, `profile apply`, `doctor`, the interactive menu — i.e. nearly every command |
| User + bundled profile files | `profiles/registry.ts:28, 93` | `profile list`, `profile show`, `doctor` |
| `config.json` | `config/store.ts:33` | every command that reads state |
| Windows Terminal `settings.json` | `apply.ts:91` | `theme apply`, `profile apply`, `backup create` |

Scenario: drop a 4 GB `%APPDATA%\nightshift\themes\huge.json` (or let a buggy third-party
tool generate one). `nightshift theme list` calls `fs.readFileSync(filePath, "utf8")` with no
cap. Node's string limit (~512 MB on 64-bit V8, ~1 GB cap on buffer) means this does not even
reach `JSON.parse`: `readFileSync` throws `ERR_STRING_TOO_LONG`. That *is* caught by the
`try`/`catch` at `registry.ts:27`, so `theme list` degrades gracefully — but only after Node
has attempted to allocate the whole file. Below the hard limit (say 300 MB) it succeeds and
NIGHTSHIFT genuinely holds a 300 MB string plus its parsed object graph in memory, for a
`theme list`. `config.json` is worse: `store.ts:33` has **no** `try`/`catch`, so an oversized
config is an uncaught crash on every command, bricking the CLI until the file is deleted by
hand.

Severity: **Medium.** Local self-inflicted DoS, no privilege gain — but it is the same class
of guard the profile importer already has, and the asymmetry is the bug. **Fixed in S2 (c)**
for theme files, profile files and `config.json`.

`settings.json` is deliberately **left uncapped**: it is Windows Terminal's own file, not
NIGHTSHIFT-authored data, and refusing to apply a theme because the user's legitimate
`settings.json` is unusually large would be a worse failure than reading it. Documented as
an accepted limitation.

---

## 4. Symlinks and TOCTOU

`assertNotSymlink()` (`src/security/paths.ts:31-41`) `lstat`s the target and throws if it is
a symlink; a missing file returns cleanly ("nothing to protect against" — correct, since the
subsequent create is not a symlink-follow risk).

### F-4 — `atomicWriteFileSync` has an inherent check-to-use window (Low, accepted)

`src/utils/atomicWrite.ts:10-16`:

```ts
fs.mkdirSync(dir, { recursive: true });
const tempPath = path.join(dir, `.${path.basename(targetPath)}.${crypto.randomUUID()}.tmp`);
fs.writeFileSync(tempPath, content, "utf8");
fs.renameSync(tempPath, targetPath);
```

- Callers that need it call `assertNotSymlink(dest)` *before* `atomicWriteFileSync` —
  `manager.ts:79` (import), `manager.ts:113` (export). Between the `lstat` and the `rename`
  there is a window in which an attacker could swap the target for a symlink. **Not
  closable with the sync `fs` API**; it would need `fs.open` with `O_NOFOLLOW` (not portable
  to Windows) or an `openSync`-based write to a held handle. Given the attacker must already
  have write access to the same directory as the target, there is no privilege gain, so the
  window is accepted, not fixed.
- The `rename` itself is the thing that matters and it is correct: temp file is in the **same
  directory** (same volume, so `rename` is atomic), has a `crypto.randomUUID()` in its name
  (no predictable-temp-name attack, no collision between concurrent runs), and is dot-
  prefixed so a crashed run's leftovers do not get picked up by the `*.json` scans in
  `themes/registry.ts:19` and `profiles/registry.ts:25`.
- **`renameSync` follows a symlink at the target**, which is why the caller-side
  `assertNotSymlink` is load-bearing. Two write paths lack it: `writeConfig`
  (`config/store.ts:38`) and `restoreBackup` (`backup/manager.ts:80`) — see F-1. Both write
  to paths the attacker would need user-level write access to poison anyway.
- A crash between `writeFileSync` and `renameSync` leaves a `.tmp` file behind. No cleanup
  exists; harmless (dot-prefixed, UUID-named, skipped by the scanners) but it accumulates.

Backup/restore ordering (`src/cli/commands/theme.ts`) is backup → write → verify → rollback,
and per `SECURITY.md` the rollback also fires if the *subsequent config write* fails. That is
the right ordering and is integration-tested.

---

## 5. Secrets and path leakage

- **Repo:** `grep -rniE "api[_-]?key|secret|password|token|bearer|private[_-]key"` over
  `src/ tests/ profiles/ docs/ *.md *.json` returns only `js-tokens` (a lockfile dependency
  name) and prose about "semantic color tokens". **No credentials.**
- **`npm pack --dry-run`:** 61 files, 33.0 kB — `dist/**` (+ source maps), `LICENSE`,
  `README.md`, `package.json`, `profiles/*.json`. No `.env`, no test fixtures, no
  `node_modules`, no dotfiles. **Clean.** (Separately: `files` lists `themes` and `schemas`,
  which do not exist — a packaging defect, gap G19, owned by N2, not a security issue.)
- **No telemetry, no network, no `child_process`:** confirmed —
  `grep -rn "require(\|child_process\|exec\|spawn\|fetch(\|http" src/` finds no network or
  process-spawning API. The only `eval`-adjacent surface would be a plugin loader; there is
  none.
- **Backup `metadata.json`** captures `originalPath` — an absolute path such as
  `C:\Users\<name>\AppData\Local\Packages\Microsoft.WindowsTerminal_…\LocalState\settings.json`,
  so it contains the OS username. That is **appropriate**: restore cannot work without
  knowing where to put the file back, and the metadata never leaves
  `%APPDATA%\nightshift\backups\`. It is *displayed* by `backup list`, which is the user
  seeing their own path on their own machine. No credentials, no env dump, no command line
  is recorded. **Acceptable** — but worth noting if a "share your backup" or bug-report
  feature is ever added, because that file would then carry the username off-machine.
- **Error messages:** `UnsafePathError` (`security/paths.ts:6`) includes both the attempted
  and the base path, and `doctor`/`profile` surface absolute paths. For a single-user local
  CLI these are the user's own paths and the diagnostics are the point. No cross-user leak
  exists because there is no multi-user surface. **Acceptable.**

---

## 6. Dependency advisories

Verified against a fresh `npm audit` (full output in §"Before" of the S2 remediation record
below): **10 vulnerabilities — 7 moderate, 1 high, 2 critical.** Matches the briefed table.

| Advisory | Severity | Package | Reach | Assessment |
|---|---|---|---|---|
| GHSA-mrhx-c7xc-m3w5 | **High** | `zod` `<4.6.6` (installed 3.25.76) | **runtime dependency** — ships in the tarball, reached by every parse | **The only finding that reaches end users.** See analysis below. Action: upgrade to 4.x. |
| GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr | **Critical** | `tinypool` `<=2.1.1` via `vitest` 3 | devDependency | Not shipped (confirmed by `npm pack`). Exploitation requires feeding attacker-controlled `run()`/worker options to tinypool; this repo's suite passes no untrusted input. Real risk to *us* ≈ nil, but it is a free fix via `vitest` 5 and leaving two criticals on the board is indefensible in a security posture doc. Action: upgrade. |
| GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8 | Moderate | `@vitest/mocker` `<=4.1.11` via `vitest` 3 | devDependency | Same reasoning; cleared by the same `vitest` 5 bump. |
| GHSA-g3hv-75wg-m249 | Moderate | `minimatch` 7–11 via `@typescript-eslint/*` 8.19 | devDependency (lint only) | Glob-amplification DoS against the linter's own glob expansion. Needs a hostile glob pattern in our own eslint config. Non-issue in practice; cleared by a `@typescript-eslint` bump. Action: upgrade. |

### On the previous "do not upgrade Zod" decision

`docs/SECURITY-MODEL.md` (as of this audit) argued the zod finding is a false positive
because the vulnerable code (`$ZodArray.handleArrayResult`) exists only in Zod 4's rewritten
internals, no patched 3.x exists, and NIGHTSHIFT's schemas never call `.array()`.

The *mechanism* half of that analysis is correct and I am not contradicting it: grep confirms
`src/` still has no `.array()` or `.record()`, so we do not exercise the specific
memory-exhaustion path. The *conclusion* no longer holds, for three reasons:

1. "No patched 3.x exists" is an argument for migrating, not for staying. It means 3.x is
   permanently and unfixably flagged — a dependency the advisory database will never clear.
2. We have no way to prove to a downstream consumer that we don't hit the vulnerable path.
   They run `npm audit` on their tree, see a **high-severity finding in a runtime dependency
   of nightshift-cli**, and that is the end of the conversation.
3. The upgrade cost was estimated as "every schema and parse call site". Measured, it is far
   smaller: 3 schema files, 2 `.error.issues` consumers (`profiles/manager.ts:52`,
   `profiles/registry.ts:98`), and **zero** tests that assert on error shape (every schema
   test asserts only `result.success`). That changes the cost-benefit decisively.

**Revised decision: upgrade to Zod 4.** Executed in S2; `docs/SECURITY-MODEL.md` updated to
record the reversal and its reasoning.

---

## 7. Insecure defaults

Reviewed and found none worth filing:

- No destructive operation happens without an explicit flag: export and import both require
  `--overwrite` to clobber (`manager.ts:71, 105`), `profile remove` refuses built-ins
  (`manager.ts:123`), `theme apply` always backs up first.
- Built-in ids cannot be shadowed by user files: import rejects them up front
  (`manager.ts:64`) and `listProfiles()` re-checks at load (`registry.ts:56-58`), so a
  hand-placed file still cannot impersonate a bundled profile.
- Malformed user files are skipped, never coerced or partially applied
  (`registry.ts:27`, `themes/registry.ts:24`), and `doctor` surfaces what was skipped
  (`inspectUserProfilesDirectory`) so "silently ignored" does not become "silently wrong".
- The strict profile schema rejects unknown keys rather than dropping them, so a file
  carrying a not-yet-supported `widgets` key fails loudly instead of being half-honoured.

---

## 8. Remediation summary

| ID | Finding | Severity | Status |
|---|---|---|---|
| G1 | `zod` 3.25.76 high-severity runtime advisory | **High** | **Fixed in S2 (a)** — upgraded to 4.x |
| G2 | `tinypool` criticals via `vitest` 3 | Critical (dev-only) | **Fixed in S2 (b)** — `vitest` 5 |
| G3 | `minimatch` moderate via `@typescript-eslint` | Moderate (dev-only) | **Fixed in S2 (b)** |
| G9 | No size cap on theme/profile/`config.json` reads | Medium | **Fixed in S2 (c)** — shared cap |
| G7 / F-2a | `settings.schemes` element casts | Low (type lie; verified not crashing today) | **Fixed in S2 (d)** — type honesty + 12 regression tests |
| F-2c | `profiles` as a legacy array is mangled into index keys | Low | **Not remediated** — needs an error-path/UX decision; filed for D2 |
| F-1 | `restoreBackup` writes an unvalidated `originalPath`, no `assertNotSymlink` | Low | **Not remediated** — needs a `BackupMetadata` Zod schema; belongs with D2/Q2's corrupt-state test work (G17). No privilege gain, so it does not outrank the above. |
| F-2b | Backup metadata cast in `listBackups` | Low | **Not remediated** — same fix as F-1. |
| F-4 | `assertNotSymlink` → `rename` TOCTOU window | Low | **Accepted, documented.** Not closable with the sync `fs` API portably; no privilege gain. |
| — | `config.json` parsed with `.parse`, not `.safeParse` — corrupt config crashes every command | Low | **Not remediated** — a UX/robustness fix (G17), owned by D2/Q2, not a security boundary. |
| — | `settings.json` read left uncapped | Low | **Accepted, documented** (reasoning in §3). |

`npm audit` before/after and the post-upgrade gate results are recorded in
`docs/SECURITY-MODEL.md`.
