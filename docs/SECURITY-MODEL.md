# Security model

This supplements `SECURITY.md` with the reasoning behind specific decisions, so future
contributors don't have to re-investigate them.

## Dependency audit: zod GHSA-mrhx-c7xc-m3w5

`npm audit` flags installed `zod@3.25.76` under `GHSA-mrhx-c7xc-m3w5` ("Zod can exhaust memory
while validating oversized constrained collections"), range `<4.6.6`, fix `zod@4.6.7`.

Investigated 2026-11-09:

- The advisory's actual mechanism is in `$ZodArray.handleArrayResult` — a class that only
  exists in Zod 4's rewritten internals. Zod 3 does not have this code path.
- `npm view zod versions` shows no 3.x release newer than our installed `3.25.76` (the only
  later entry is a 2025 canary prerelease) — there is no "patched 3.x" because 3.x was never
  the affected branch.
- Our own schemas (`src/core/themes/schema.ts`, `src/core/profiles/schema.ts`) never call
  `.array()` (`grep -rn "\.array(" src/` returns nothing), so even if the advisory did apply
  to 3.x, we don't exercise the vulnerable surface.

**Decision: do not upgrade to Zod 4.** `npm audit`'s version range is broader than the actual
vulnerable code — it expresses "any 4.x before 4.6.6" in a way that technically also matches
every 3.x release, which is a false positive for this dependency tree. A 3→4 migration has
real breaking-API cost (every schema and parse call site) for zero actual risk reduction here.
Revisit only if NIGHTSHIFT schemas ever add unconstrained `.array()`/`.record()` validation of
untrusted input, or if we move to Zod 4 for an unrelated reason.

## Other npm audit findings

The remaining 9 advisories (vitest/`@vitest/mocker`/tinypool, `@typescript-eslint`'s
`minimatch` transitive dependency) are all in `devDependencies` — the test runner and linter.
Verified via `npm pack --dry-run`: the published package contains only `dist/`, `profiles/`,
`LICENSE`, `README.md`, `package.json` — none of these packages ship to end users. They're
only relevant to someone running this repo's own test/lint suite locally, and even then
`tinypool`'s prototype-pollution issue requires something to feed it attacker-controlled
`run()` options, which this project's test suite never does with untrusted input.

## Untrusted input paths (current, 0.1.0 scope)

| Input | Validation |
|---|---|
| User theme JSON (`%APPDATA%\nightshift\themes\*.json`) | Zod schema, malformed files skipped |
| Backup id (CLI arg to `restore <id>`) | `resolveSafePath` traversal guard |
| Windows Terminal `settings.json` | Parsed as JSON, must be a non-array object; unrelated keys preserved, never executed |

No path in 0.1.0 executes code from a theme, profile, or imported file.
