# NIGHTSHIFT — Bug Report (debugging-agent, D1/D2)

Branch: `feat/nightshift-1.0.0`
Scope: the surface changed by Waves A/B/C-prep plus the debugging agent's own files —
`src/adapters/windows-terminal/apply.ts`, `src/adapters/windows-terminal/locate.ts`,
`src/backup/manager.ts`, `src/core/capabilities/detect.ts`.

Every reproduction below was **actually run**. Probe scripts were created in `$(mktemp -d)`
against `dist/`, or against `src/` through vitest, never in the repository, and were deleted.
No command in this document ran against the developer's real Windows Terminal
`settings.json`: `LOCALAPPDATA` and `APPDATA` were pointed at temporary directories
throughout.

Areas already closed in earlier waves (corrupt `config.json`, path traversal, oversized JSON
files, table widths, `NO_COLOR`, the non-TTY hang) were **not** re-probed beyond the
spot-checks in §7.

---

## 1. D-1 / G25 — legacy array `profiles` silently destroys the user's profile list

| | |
|---|---|
| Severity | **High** — silent, unrecoverable-looking loss of the user's terminal configuration, inside the one operation this product exists to perform safely |
| Root cause | `src/adapters/windows-terminal/apply.ts:71-74` (pre-fix): `settings.profiles` was object-spread behind a bare `typeof value === "object"` test, and `typeof [] === "object"` |
| Status | **Fixed** |

Windows Terminal's legacy (pre-1.0) settings format put `profiles` at the root as a JSON
**array**. `{ ...["a","b"] }` evaluates to `{"0":"a","1":"b"}`, so the merge rewrote the array
into an object with numeric keys — a shape Windows Terminal cannot read — and the apply engine
then *verified successfully*, because verification only checks that the colour scheme is
present.

### Reproduction (unit level)

```js
// $(mktemp -d)/g25.mjs
import { mergeThemeIntoSettings } from "file:///D:/CTP/dist/adapters/windows-terminal/apply.js";
import { builtinThemes } from "file:///D:/CTP/dist/core/themes/builtin.js";
const theme = builtinThemes.find((t) => t.id === "ghost-protocol");
const legacy = {
  globals: { defaultProfile: "{guid-1}" },
  profiles: [
    { guid: "{guid-1}", name: "PowerShell", commandline: "pwsh.exe" },
    { guid: "{guid-2}", name: "cmd", commandline: "cmd.exe" },
  ],
};
console.log("IN :", JSON.stringify(legacy.profiles));
console.log("OUT:", JSON.stringify(mergeThemeIntoSettings(legacy, theme).profiles));
```

Observed **before** the fix (exit `0`):

```text
IN : [{"guid":"{guid-1}","name":"PowerShell","commandline":"pwsh.exe"},{"guid":"{guid-2}","name":"cmd","commandline":"cmd.exe"}]
OUT: {"0":{"guid":"{guid-1}","name":"PowerShell","commandline":"pwsh.exe"},"1":{"guid":"{guid-2}","name":"cmd","commandline":"cmd.exe"},"defaults":{"colorScheme":"Ghost Protocol","font":{"face":"Cascadia Code","size":14}}}
```

### Reproduction (engine level, temp `LOCALAPPDATA`)

`applyThemeFileOnly("ghost-protocol")` against a temp
`%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json`
containing `{"globals":{},"profiles":[{"guid":"{1}","name":"PowerShell"}]}`.

Observed **before** the fix:

```text
[arr] apply -> {"ok":true,"message":"Applied \"Ghost Protocol\" to Windows Terminal (...settings.json).","backupId":"1794713816232-88843192"}
[arr] file  -> {
    "globals": {},
    "profiles": {
        "0": {
            "guid": "{1}",
            "name": "PowerShell"
        },
        "defaults": {
            "colorScheme": "Ghost Protocol",
```

**`ok: true`. "Applied". Profile list gone.** That combination is what makes this High rather
than Medium.

### Decision: refuse, do not migrate

The security agent's position was adopted. `mergeThemeIntoSettings` now throws on a
`profiles` that is present and not a plain object, and the reasoning is recorded in the code:

- Converting the legacy root array into the modern `{ defaults, list }` form means **guessing**
  at a schema migration of the user's entire profile list — whether to wrap it as `list`,
  whether to fold `globals` into the root, what to do with duplicate GUIDs. Getting that wrong
  is the same failure as the bug, just slower.
- Declining is recoverable: Windows Terminal migrates the legacy file itself the first time its
  settings UI is opened. A silent rewrite is not recoverable; the user has no reason to look.
- Refusing is free in safety terms. `applyThemeFileOnly` already creates a backup *before*
  the merge and rolls back on any throw, so a thrown error lands on the existing safe path with
  no new error handling — the same reason the message is a plain `Error` with a self-contained
  remedy rather than a `NightshiftError`: the caller converts it into
  `{ ok: false, message }` and the hint would be discarded.

Observed **after** the fix (engine level):

```text
ok: false
message: Failed to apply theme and restored previous settings: Windows Terminal's "profiles"
is a JSON array (the legacy pre-1.0 settings format). NIGHTSHIFT will not rewrite it, because
converting it to the current { defaults, list } form would mean guessing at a migration of
your whole profile list. Open Windows Terminal's settings UI once to let it migrate the file,
then re-run this command.
settings.json: byte-identical to before
```

### Siblings fixed by the same guard (root cause, not symptom)

The spread-behind-a-`typeof`-test pattern appeared three times in the same function. All three
now route through one `requirePlainObject()` helper, so the fix is one guard rather than one
per container:

| Shape | Pre-fix observed | Post-fix |
|---|---|---|
| `profiles: [a, b]` | `{"0":a,"1":b}` — profile list destroyed | refused |
| `profiles: "Campbell"` / `42` / `true` / `null` | key silently **replaced** by `{defaults:…}`, value discarded | refused, naming `"profiles"` |
| `profiles.defaults: [1,2]` | `{"0":1,"1":2,"colorScheme":…}` | refused, naming `profiles.defaults` |
| `profiles.defaults: "x"` / `7` / `null` | silently discarded | refused |
| `profiles.defaults.font: "Cascadia Code"` | would spread to `{"0":"C","1":"a",…}` | refused, naming `profiles.defaults.font` |
| `profiles` absent | merged normally | unchanged — still merges normally |
| `profiles.list` any shape | untouched | untouched (it is never spread) |

Regression tests: `tests/unit/wt-settings-shapes.test.ts`,
`tests/integration/wt-legacy-profiles.test.ts`.

---

## 2. D-2 — a UTF-8 BOM in `settings.json` fails every theme apply

| | |
|---|---|
| Severity | Medium — the failure is safe (backup + rollback) but the cause is unguessable, and the trigger is "the user opened settings.json in Notepad once" |
| Root cause | `src/adapters/windows-terminal/apply.ts:105-106` (pre-fix): `JSON.parse` on raw file text. A BOM is legal in a UTF-8 file; `JSON.parse` rejects it |
| Status | **Fixed** — the BOM is stripped before parsing |

Reproduction: write `"\uFEFF{\"copyOnSelect\":true}"` to a temp `settings.json`, call
`applyThemeFileOnly("ghost-protocol")`.

Observed before:

```text
{"ok":false,"message":"Failed to apply theme and restored previous settings: Unexpected token '﻿', \"﻿{\"copyOnS\"... is not valid JSON"}
```

After: parses normally. CRLF line endings were probed in the same pass and were already fine
(`{"copyOnSelect":true}` parsed) — no defect, test added to keep it that way.

---

## 3. D-3 — a JSONC (`//`-commented) `settings.json` reports a raw `SyntaxError`

| | |
|---|---|
| Severity | Medium |
| Root cause | `src/adapters/windows-terminal/apply.ts:106` (pre-fix): the `JSON.parse` failure was relayed verbatim and named neither the file nor the cause |
| Status | **Fixed (message only)** — see the deliberate limitation below |

Windows Terminal documents `settings.json` as JSONC, and its own generated file has historically
carried a `// This file was initially generated by Windows Terminal` header. (Checked: the
developer's real file on this machine has no comments and no BOM, so this is a documented
format allowance rather than a universal condition.)

Observed before:

```text
{"ok":false,"message":"Failed to apply theme and restored previous settings: Unexpected token '/', \"// generat\"... is not valid JSON"}
```

Observed before, for an empty (0-byte) `settings.json` — same root cause:

```text
{"ok":false,"message":"Failed to apply theme and restored previous settings: Unexpected end of JSON input"}
```

Both now name the file, the parse error, and a remedy; the commented case says so specifically.
The detection pattern requires `//` to open a line, so `"$help": "https://aka.ms/..."` is not
mistaken for a comment (tested).

**Deliberately not fixed: NIGHTSHIFT does not parse JSONC.** Doing it properly needs a JSONC
parser (a new dependency — not allowed, and not warranted), and a regex comment-stripper would
corrupt any string value containing `//`. More fundamentally, NIGHTSHIFT writes with
`JSON.stringify`, so even a successful JSONC *parse* would **delete every comment** on write.
Refusing with an explanation is the honest behaviour; silently discarding the user's comments
is the same class of defect as G25. Round-tripping comments is a design decision for the
architecture owner, not a bug fix.

---

## 4. F-1 — backup `metadata.json` was read through an unvalidated cast

| | |
|---|---|
| Severity | Medium (robustness / defence in depth). Poisoning `metadata.json` already requires the user's own write rights under `%APPDATA%`, so this is **not** a privilege boundary — but `restore` is the recovery command and must not be the thing that breaks |
| Root cause | `src/backup/manager.ts:53` and `:71` (pre-fix): `JSON.parse(...) as BackupMetadata` in both readers |
| Status | **Fixed** |

### 4a. `restoreBackup()` threw a `TypeError` from inside `node:path`

Reproduction: create a backup, overwrite its `metadata.json`, call `restoreBackup(id)`.

Observed before:

```text
[wrong-shape] THREW TypeError: The "path" argument must be of type string. Received undefined
[num-path]    THREW TypeError: The "path" argument must be of type string. Received type number (42)
[null-path]   THREW TypeError: The "path" argument must be of type string. Received null
[array-meta]  THREW TypeError: The "path" argument must be of type string. Received undefined
```

Each reached the user as `✗ The "path" argument must be of type string…` at exit `1` —
naming neither the backup, the file, nor the remedy.

Observed after, through the real binary:

```console
$ APPDATA=$(mktemp -d) node dist/index.js restore 1700000000000-aaaaaaaa
✗ "…\nightshift\backups\1700000000000-aaaaaaaa\metadata.json" is not valid backup metadata
(id: Invalid input: expected string, received undefined; createdAt: Invalid input: expected
string, received undefined; originalPath: Invalid input: expected string, received undefined;
reason: Invalid input: expected string, received undefined). Delete that backup directory, or
fix the file by hand.
  → Run `nightshift backup list` to see available backup ids.
exit=1
```

### 4b. `listBackups()` crashed the whole listing — order-dependent

This one was **not** in the deferred note and is the more damaging half. The `try` wrapped only
`JSON.parse`; the `.sort()` comparator sat outside it:

```js
return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
```

A `metadata.json` that is valid JSON but lacks `createdAt` therefore reached the comparator.
Reproduction: create 6 backups, replace the first and last `metadata.json` with `{"hello":1}`,
call `listBackups()`.

Observed before:

```text
[list-6-with-broken-last] -> 6
[list-6-with-two-broken]  THREW TypeError: Cannot read properties of undefined (reading 'localeCompare')
```

Note the first line: whether it crashes depends on V8's sort order, so `nightshift backup list`
broke **intermittently** — and `backup list` is the command the restore hint tells users to run.

Observed after, through the real binary (one good entry, one shape-broken entry):

```console
$ COLUMNS=100 APPDATA=$(mktemp -d) node dist/index.js backup list
┌────────────────────────┬──────────────────────────────────┬───────────────┬──────────────────────┐
│ ID                     │ Created                          │ Reason        │ Source               │
├────────────────────────┼──────────────────────────────────┼───────────────┼──────────────────────┤
│ 1700000000001-bbbbbbbb │ 2026-01-01T00:00:00.000Z         │ manual backup │ D:/tmp/settings.json │
└────────────────────────┴──────────────────────────────────┴───────────────┴──────────────────────┘
exit=0
```

### 4c. The restore destination had no symlink check

`restoreBackup()` wrote to `metadata.originalPath` with no `assertNotSymlink`. Probed: because
`atomicWriteFileSync` renames over the target rather than opening it, a symlinked
`originalPath` was **replaced** rather than written through —

```text
[symlink-dest] followed link, outside.json now: ORIGINAL
```

— so the link target was safe but the user's symlink was silently destroyed. `assertNotSymlink`
is now called before the write, matching every other NIGHTSHIFT write target.

### Fix

A `backupMetadataSchema` (Zod, already a dependency) with `BackupMetadata` derived from it via
`z.infer`, so the exported type and the runtime check cannot drift. Both readers go through it,
both now read via `readJsonFileWithLimit()` (the shared 64 KB cap — `metadata.json` was the one
JSON file NIGHTSHIFT read with no size guard after G9), `listBackups` validates *inside* the
`try` and skips bad entries, `restoreBackup` refuses and names the file.

**Honest limitation:** a metadata file whose `originalPath` is a *valid* string still directs
the write wherever it points. Confirmed pre- and post-fix:

```text
[poisoned.json] WROTE to …\PWNED.json -> {"a":1}
```

That is inherent to `backup/manager.ts` being deliberately generic (any adapter can snapshot any
path) and to the threat model: writing that file already requires the rights the write would
grant. Pinning destinations to a whitelist would require the backup engine to know about
Windows Terminal, which `docs/ARCHITECTURE.md` explicitly rejects. Recorded, not fixed.

Regression tests: `tests/integration/backup-metadata.test.ts`.

---

## 5. Probed and found acceptable — no defect

| Probe | Observed | Verdict |
|---|---|---|
| `schemes` with names differing only in case (`ghost protocol`, `GHOST PROTOCOL`, `Ghost Protocol`) | all three kept, exact-name entry replaced | Correct. Windows Terminal matches `colorScheme` by exact string, so case variants are distinct schemes. Test added to pin it |
| Two backups created in the same millisecond | `1794713845525-bb96440a`, `1794713845539-fa196a7f`, `1794713845543-b29ee419` — ids unique | No collision. Ids are `${Date.now()}-${randomUUID().slice(0,8)}`; the UUID suffix carries uniqueness independently of clock granularity |
| `createBackup()` when the source file does not exist | backup directory created, no `snapshot.json`; later `restore` → `Backup "…" has no snapshot (the original file did not exist when the backup was taken)` | Correct and already explained |
| `restoreBackup()` with a missing snapshot file | same clear message, exit `1` | Correct |
| `locate.ts`: `settings.json` exists as a **directory** | located (`fs.existsSync` is true for a directory), then `applyThemeFileOnly` → `ok:false`, `Failed to create a backup before applying the theme: EPERM: operation not permitted, copyfile …` | Degrades safely, nothing written. Message is cryptic but the condition is pathological (a user created a *directory* named `settings.json`) and the exit code and rollback are right. Not fixed — a dedicated `statSync().isFile()` check in `locate.ts` buys a nicer message for a case no real user reaches |
| `locate.ts`: 0-byte `settings.json` | located, then the §3 parse message | Fixed as part of §3 |
| `detectCapabilities()` with `LOCALAPPDATA` and `APPDATA` both unset | `{"platform":"win32","platformSupport":"supported","windowsTerminal":{"support":"unknown","settingsPath":null},"claudeCode":{…}}` | Correct degradation, no throw |
| `detectCapabilities()` on a simulated non-`win32` platform | `{"platform":"linux","platformSupport":"unsupported","windowsTerminal":{"support":"unsupported","settingsPath":null},…}` | Correct, no throw |
| `settings.json` that is valid JSON but an array at the root | `"…settings.json" does not contain a JSON object at its root` | Already correct; test added |
| CRLF line endings in `settings.json` | parsed | Already correct; test added |

---

## 6. Considered and rejected

**A size cap on `settings.json` reads.** G9 established one shared `MAX_JSON_FILE_BYTES`
(64 KB) for NIGHTSHIFT's JSON files, and `readWindowsTerminalSettings()` still reads without
one. It was left uncapped deliberately: the developer's real `settings.json` is **4,831 bytes**,
but a power user with many profiles and a large `schemes` array can plausibly approach 64 KB
(each scheme is ~700 bytes, so ~80 schemes alone would exceed it). Refusing to theme a
legitimate large configuration is a worse failure than the one the cap prevents, and the file
is already copied wholesale by `createBackup` before it is read. A cap here needs its own
(larger) constant and a justification, which is an architecture decision rather than a bug fix.

---

## 7. Spot-checks of previously closed areas

Re-verified only, not re-investigated:

```console
$ APPDATA=$B node dist/index.js theme list   # $B/nightshift/config.json contains [1,2,3]
… full theme table still printed …
exit=2

$ node dist/index.js frobnicate
exit=1
```

Both match the exit-code contract in `docs/ARCHITECTURE.md` (degrade *and* report; usage errors
share `1`).

---

## 8. Gate results after the fixes

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass, 0 errors 0 warnings |
| `npm run build` | pass |
| `npm test` | **268 passed, 25 files** (floor was 204/19; +32 from this work, the remainder from the other agents running concurrently) |

Every regression test in `tests/unit/wt-settings-shapes.test.ts` (19 tests, 14 of them new
assertions that failed), `tests/integration/backup-metadata.test.ts` (12 tests, 11 failing) and
`tests/integration/wt-legacy-profiles.test.ts` (1 test, failing) was **observed failing before
its fix** — recorded in the agent's report with the pre-fix assertion output. No existing test
was weakened, skipped, or deleted.
