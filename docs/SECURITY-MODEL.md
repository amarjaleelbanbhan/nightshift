# Security model

This supplements `SECURITY.md` with the reasoning behind specific decisions, so future
contributors don't have to re-investigate them.

## Dependency audit status

**As of 2026-11-15, `npm audit` reports 0 vulnerabilities.** Before the remediation described
below it reported **10 (7 moderate, 1 high, 2 critical)**.

```
# before
10 vulnerabilities (7 moderate, 1 high, 2 critical)

# after
found 0 vulnerabilities
```

### zod GHSA-mrhx-c7xc-m3w5 — resolved by upgrading to Zod 4 (decision reversed)

`npm audit` flagged `zod@3.25.76` under `GHSA-mrhx-c7xc-m3w5` ("Zod can exhaust memory while
validating oversized constrained collections"), range `<4.6.6`, **high severity**, in a
**runtime** dependency.

A previous investigation (2026-11-09) concluded *do not upgrade*, on the grounds that the
advisory's mechanism (`$ZodArray.handleArrayResult`) exists only in Zod 4's rewritten
internals, that no patched 3.x exists because 3.x was never the affected branch, and that our
schemas never call `.array()` so the vulnerable surface is not exercised.

**That decision was reversed on 2026-11-15 and `zod` is now `^4` (installed 4.6.7).** The
mechanism analysis above is still correct — `grep -rn "\.array(\|\.record(" src/` remains
empty — but it did not support the conclusion:

1. "No patched 3.x exists" argues *for* migrating, not for staying. It means 3.x is
   permanently and unfixably flagged by the advisory database.
2. We cannot prove non-reachability to a downstream consumer. They run `npm audit` on their
   own tree, see a high-severity finding in a runtime dependency of `nightshift-terminal`, and
   stop there.
3. The migration cost was estimated as "every schema and parse call site". **Measured, it was
   one line.** Three schema files, two `.error.issues` consumers, and zero tests asserting on
   Zod error shape — every schema test asserts only `result.success`. Typecheck, lint, build
   and all 73 baseline tests passed on `zod@4.6.7` with no source change at all; the single
   edit made was migrating `z.object({...}).strict()` to `z.strictObject({...})` in
   `src/core/profiles/schema.ts`, because `.strict()` is deprecated in Zod 4 and a
   silently-removed `.strict()` would downgrade the profile schema from *rejecting* unknown
   keys to *stripping* them. `tests/unit/profile-schema.test.ts` asserts that rejection.

No validation was weakened in the migration, and no Zod 3 behavior proved inexpressible in
Zod 4. Specifically preserved and test-covered: the strict profile schema
(unknown keys rejected), `z.literal("1.0")` schema-version pinning, the hex-color regex, and
`activeProfileId: z.string().nullable().default(null)` in `src/core/config/store.ts` — the
forward-compatibility shim that lets 0.1.0 config files written before that field existed
still parse (`tests/unit/config-store.test.ts`).

### devDependency advisories — resolved

- `vitest` 3 → **5** clears the two **critical** `tinypool` prototype-pollution→RCE
  advisories (GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr) and the two moderate
  `@vitest/mocker` advisories (GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8). No config or test
  API change was required: `vitest.config.ts` is unchanged and all tests pass on 5.1.0.
- `@typescript-eslint/*` 8.19 → **8.72.2** does **not** on its own clear
  GHSA-g3hv-75wg-m249 (`minimatch` glob-amplification DoS). 8.72.2 is the latest stable
  release and still depends on `minimatch: ^10.2.2`, while the advisory covers
  `7.0.0 - 11.0.0`; there is no forward-fixed `@typescript-eslint` release, and `npm audit
  fix --force` "fixes" it by *downgrading* the parser to 6.15.0. It is instead resolved with
  a narrowly scoped lockfile override in `package.json`:

  ```json
  "overrides": { "@typescript-eslint/typescript-estree": { "minimatch": "^11.0.8" } }
  ```

  Scoped to `typescript-estree` specifically so ESLint's own `minimatch@3.1.5` (outside the
  advisory range) is untouched. Verified not to be a no-op: `npm ls minimatch` confirms
  `minimatch@11.0.8` under `typescript-estree`, `npm run lint` passes, and a deliberate
  `const x: any = 1` probe still produces
  `error @typescript-eslint/no-explicit-any` — so type-aware linting genuinely still works
  rather than silently matching nothing. **Remove this override once `@typescript-eslint`
  ships a release depending on `minimatch >= 11.0.1`.**

These are all devDependencies. Verified via `npm pack --dry-run`: the published package
contains only `dist/`, `profiles/`, `LICENSE`, `README.md`, `package.json` — none of these
ship to end users.

## Resource-exhaustion guards

A single shared cap, `MAX_JSON_FILE_BYTES = 64 KB` in `src/security/limits.ts`, applies to
every JSON file NIGHTSHIFT reads off disk: user themes, user and bundled profiles,
`config.json`, and profile imports. `readJsonFileWithLimit()` checks the size with `stat`
**before** `readFileSync`, so an oversized file is never allocated — checking after the read
would be no guard at all.

Previously only profile import was capped (its own `MAX_IMPORT_BYTES`, now consolidated into
the shared constant), so a 4 GB `%APPDATA%\nightshift\themes\huge.json` was read
unconditionally by `theme list`, and an oversized `config.json` crashed every command.

**Windows Terminal's `settings.json` is deliberately left uncapped.** It is Windows
Terminal's own file, not NIGHTSHIFT-authored data, and refusing to apply a theme because the
user's legitimate `settings.json` is unusually large would be a worse failure than reading
it. Accepted limitation.

## Windows Terminal `settings.json` handling

`readWindowsTerminalSettings()` validates only that the root is a non-null, non-array object
and then types it `Record<string, unknown>`. This is intentional and should not be "fixed"
with a schema: NIGHTSHIFT must **preserve every unrelated key** it does not understand, so a
schema rejecting unknown keys would be actively wrong here.

`mergeThemeIntoSettings()` therefore treats `settings.schemes` as `unknown[]`, not as a
typed scheme array. A non-array `schemes` becomes an empty list; non-object elements
(`null`, strings, numbers, nested arrays) are passed through untouched rather than having
`.name` read off them, because NIGHTSHIFT does not delete data it does not understand. 12
hostile-shape cases are asserted in `tests/unit/windows-terminal-apply.test.ts`.

This is a **robustness** boundary, not a privilege boundary: `settings.json` is owned by the
same user running NIGHTSHIFT, it is never executed, and no value read from it flows into a
path, a command, or any other sink. See `docs/development/SECURITY_AUDIT.md` F-2a.

## Accepted limitations

- **`assertNotSymlink()` → `renameSync` TOCTOU window.** Callers `lstat` the destination
  before `atomicWriteFileSync`; an attacker could swap the target for a symlink in between.
  Not closable portably with the synchronous `fs` API (`O_NOFOLLOW` is not a Windows
  concept), and the attacker must already hold write access to the destination directory, so
  there is no privilege gain. Accepted.
- **`restoreBackup()` writes to `metadata.originalPath`**, an unvalidated field read from
  `metadata.json`, with no `assertNotSymlink`. Poisoning that file requires the user's own
  privileges — at which point the attacker can write the target directly — so there is no
  privilege gain, but it should still be Zod-validated for honest error messages on a
  corrupt backup. Tracked as audit finding F-1.
- **`config.json` is parsed with `.parse`, not `.safeParse`**, so a corrupt config crashes
  with a raw `ZodError` instead of a friendly message. Robustness, not security.

## Untrusted input paths (current, 0.2.0 scope)

| Input | Validation |
|---|---|
| User theme JSON (`%APPDATA%\nightshift\themes\*.json`) | 64 KB size cap, Zod schema, malformed/oversized files skipped |
| User profile JSON (`%APPDATA%\nightshift\profiles\*.json`) | 64 KB size cap, **strict** Zod schema (unknown keys rejected), built-in ids cannot be shadowed |
| Imported profile file (CLI arg to `profile import <file>`) | 64 KB size cap checked before read, must be a regular file, strict Zod schema, referenced theme must exist, built-in ids refused, destination `resolveSafePath` + `assertNotSymlink` |
| `config.json` | 64 KB size cap, Zod schema |
| Profile id (CLI arg to `profile remove/show/apply <id>`) | `resolveSafePath` traversal guard + id regex |
| Backup id (CLI arg to `restore <id>`) | `resolveSafePath` traversal guard |
| Windows Terminal `settings.json` | Parsed as JSON, must be a non-array object; element shapes not assumed; unrelated keys preserved, never executed |
| Font path (CLI arg to `font install <path>`) | `..` segments refused, symlinked source refused, `.ttf`/`.otf`/`.ttc` only, 32 MB per file and 256 files per directory install checked via `stat` before any read, must declare a family in its sfnt `name` table, destination `resolveSafePath` under `%LOCALAPPDATA%\Microsoft\Windows\Fonts` + `assertNotSymlink`, written with `atomicWriteFileSync` |
| The user's PowerShell `$PROFILE` (read and spliced by `shell init`/`shell remove`) | 1 MB size cap (`MAX_SHELL_PROFILE_BYTES`) checked via `stat` before the read; path built with `resolveSafePath` under the resolved `Documents` directory; a symlink is *followed* (`realpathSync`) so the write lands on the real file instead of renaming over the link (#27); two managed blocks or an unterminated one are refused, not repaired; content outside the block is never parsed, only re-concatenated verbatim |
| `config.json`'s `activeThemeId`, when it reaches the managed block | Re-validated against `[a-z0-9-]+` and refused if it fails |

No path in 0.2.0 executes code from a theme, profile, or imported file. There is no network
call and no child-process execution anywhere in `src/` (verified by grep).

**`font install` is deliberately bounded by that last sentence.** Registering a font with
Windows means writing `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts`, which needs
`reg.exe` (a child process) or a Win32 call (a native dependency). Rather than take either, the
command copies the file and reports plainly — in the proposal, before approval, and again in
the result — that registration did not happen, printing the `reg add` command for the user to
run themselves. A font *file* is never parsed beyond its `name` table and is never executed;
the bytes are copied verbatim.
**Shell integration is deliberately bounded by that last sentence, and is the one place where
NIGHTSHIFT writes code rather than data.** The managed block in `$PROFILE` is PowerShell source
that the user's shell executes on every start, so two rules apply that do not apply elsewhere:

- **Nothing is interpolated into it unvalidated.** The only value that reaches the block is
  `activeThemeId`, which is re-checked against the theme schema's own `[a-z0-9-]+` shape in
  `core/shell/integrate.ts` and refused rather than escaped if it fails. `config.json` is a
  hand-editable file on disk, so "the theme schema validated it" is not a property of the file
  that is actually there. Writing a shell quoter instead would be a worse answer: there is no
  legitimate reason for a theme id to need quoting.
- **Nothing is executed to build it.** Asking PowerShell for `$PROFILE` and running
  `starship --version` are the two obvious implementations and both are child processes.
  Instead, the shell edition is read off `PSModulePath` (which PowerShell exports to every
  child process it starts) and Starship is found by scanning `PATH` with `fs.statSync`. The
  `starship` binary itself is never read or executed; its presence only decides whether the
  block gets a `Get-Command`-guarded init line. `starship.toml` is never read or written at
  all.
