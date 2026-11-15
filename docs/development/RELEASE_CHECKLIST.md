# Release checklist

Ordered, verifiable steps for cutting a NIGHTSHIFT release. Every step has a command and an
expected result — if a step cannot be checked by running something, it does not belong here.

**Step 10 publishes to npm and requires explicit human authorization. Nothing in this repo
performs it automatically, and nothing should.**

Preconditions: this package has **never been published**. The first release therefore also has
to settle the open items in §0, which later releases can skip.

> **The name check in §0 was run and it failed.** `nightshift-cli` is taken on npm by an
> unrelated project, which also claims the `nightshift` binary. The package is now
> `nightshift-terminal` (#39). The binary is unchanged.

---

## 0. First-release-only prerequisites

Skip once done. All three require a human decision, not a command.

- [ ] **Version number for the change set.** Owner: planner-architect. Pre-1.0 SemVer, so a
      minor bump may carry breaking changes.
- [ ] **`repository`, `bugs`, and `homepage` in `package.json`.** npm builds the package page's
      links from these; without them a published page has no route back to the source.
- [x] **Registry name availability.** `npm view <name> version` — a `404` means the name is
      free. Anything else means pick another name before going further. **Done, and it caught
      a real collision:** `nightshift-cli` returned `0.2.0` — an unrelated published package
      ("Supervisor for unattended AI agent runs", different author) that also declares
      `bin: nightshift`. Renamed to `nightshift-terminal`, verified free. Re-run this check for
      any future rename; it is cheap and it already paid for itself.
- [ ] **npm account with publish rights and 2FA enabled**, authenticated locally:
      `npm whoami` prints the expected user.

---

## 1. Start from a clean, synced tree

```
git status --short          # expect: empty
git log origin/<branch>..HEAD --oneline   # expect: empty (nothing unpushed)
```

A release must be reproducible from what is committed. `dist/` is gitignored, so anything not
committed is not in the release.

## 2. Cold install from the committed lockfile

```
npm run clean
npm ci
```

Expect `npm ci` to exit 0 and report `found 0 vulnerabilities`. `npm ci`, never `npm install` —
the `overrides` entry for `minimatch` is not recorded in `package-lock.json` as an `overrides`
object, only as a resolved dependency, so an unenforced lockfile can silently reopen a moderate
advisory. See `docs/development/DEPENDENCY_AUDIT.md` §3.

## 3. Full quality gate

```
npm run format:check   # All matched files use Prettier code style!
npm run typecheck      # exit 0
npm run lint           # exit 0, zero errors and zero warnings
npm run build          # exit 0
npm test               # all tests pass, zero failures
```

**The test count is a floor and may only rise.** It was 73 at commit `813c7c9` and is 268 now.
A release whose suite shrank is a release that deleted a test.

## 4. Security audit

```
npm audit              # found 0 vulnerabilities
```

Not `npm audit fix --force`. For this project that downgrades `@typescript-eslint/parser` to
6.15.0 — a regression dressed up as a fix (DEPENDENCY_AUDIT.md §3).

## 5. Verify the built artifact runs

```
node dist/index.js --version    # the version you are about to release
node dist/index.js --help       # full command list
head -1 dist/index.js           # #!/usr/bin/env node
```

## 6. Inspect the tarball before producing it

```
npm pack --dry-run
```

Check all four:

- [ ] `total files` is what you expect (41 at 0.2.0) — a sudden jump means something leaked in.
- [ ] `grep -c "\.map"` over the output is **0**. Shipped source maps point at a `src/` that is
      not published, and a dangling map is worse than no map: a debugger follows it and fails.
- [ ] `profiles/*.json` are present. **Load-bearing** — `dist/core/profiles/registry.js` resolves
      `../../../profiles`, and if it is missing `nightshift profile list` reports zero built-in
      profiles *silently* instead of erroring.
- [ ] No `src/`, no `tests/`, no `.env`, no `node_modules`.

## 7. Install from the tarball into a scratch directory — do not skip this

The only step that tests the published artifact rather than the repo. It has caught nothing yet,
which is the argument for keeping it, not for dropping it.

```
PKGDIR=$(mktemp -d); TARBALL=$(npm pack --pack-destination "$PKGDIR" | tail -1)
TESTDIR=$(mktemp -d); cd "$TESTDIR" && npm init -y >/dev/null
npm install "$PKGDIR/$TARBALL"
```

Then, from `$TESTDIR`, with scratch config directories so nothing touches the real machine:

```
APP=$(mktemp -d); LOCAL=$(mktemp -d)
node node_modules/nightshift-terminal/dist/index.js --version      # exact release version
./node_modules/.bin/nightshift --version                      # same, via the generated shim
APPDATA=$APP LOCALAPPDATA=$LOCAL ./node_modules/.bin/nightshift --help
APPDATA=$APP LOCALAPPDATA=$LOCAL ./node_modules/.bin/nightshift theme list     # 4 built-ins
APPDATA=$APP LOCALAPPDATA=$LOCAL ./node_modules/.bin/nightshift profile list   # 2 built-ins
APPDATA=$APP LOCALAPPDATA=$LOCAL ./node_modules/.bin/nightshift status
```

- [ ] `--version` prints the release version, not `undefined` and not a crash. This is the
      runtime-version-resolution check (`src/cli/version.ts` climbs two levels from
      `dist/cli/` to the package root); it is the classic packaging failure and it is cheap to
      re-check.
- [ ] `profile list` shows both bundled profiles — see §6.
- [ ] On Windows, `node_modules/.bin/` contains `nightshift`, `nightshift.cmd`, and
      `nightshift.ps1`.

**Do not run `theme apply`, `profile apply`, or `setup --yes` here.** They write Windows
Terminal's real `settings.json`; `APPDATA` does not sandbox that. Their behaviour is covered by
the integration suite.

Clean up: `rm -rf "$PKGDIR" "$TESTDIR" "$APP" "$LOCAL"`, and confirm no `.tgz` is left in the
repo root (`ls *.tgz` → no matches).

## 8. CHANGELOG

```
git log <previous tag or commit>..HEAD --oneline
```

- [ ] A section for the new version with the date, grouped Added / Changed / Fixed / Security.
- [ ] Every user-visible change named — new commands, changed exit codes, the `engines.node`
      floor, anything that changes what a user must do.
- [ ] **Breaking changes called out explicitly**, even pre-1.0 where SemVer permits them in a
      minor bump. `engines.node: ">=22.12.0"` is breaking for anyone on Node 18 or 20.
- [ ] The honest gaps recorded too, not just features. `BUILD_RELEASE_AUDIT.md` §7 is the list.

## 9. Version, commit, tag

```
npm version <major|minor|patch>     # edits package.json + package-lock.json, commits, tags
git show --stat HEAD
git tag                             # the new tag is present
```

- [ ] Tag format `v<version>` (e.g. `v0.3.0`). **No tags exist yet**, so the first release sets
      the convention — `npm version` produces `v`-prefixed tags by default and that is the
      convention to adopt.
- [ ] `node dist/index.js --version` matches the tag after a rebuild. `src/cli/version.ts` reads
      `package.json` at runtime, so this follows automatically — confirm it rather than assume it.

**Pushing the tag is a human action**: `git push origin <branch> --follow-tags`. A tag is
effectively permanent once others fetch it.

## 10. Publish — REQUIRES EXPLICIT HUMAN AUTHORIZATION

> **An agent must not run this step.** Publishing is irreversible in practice: npm restricts
> unpublishing heavily after 72 hours, and a published version number can never be reused. It is
> externally consequential — it puts code on other people's machines.

A human, having completed steps 1–9:

```
npm publish --dry-run     # review the exact file list one final time
npm publish               # requires 2FA
```

`prepublishOnly` runs `clean → format:check → typecheck → lint → build → test` before npm
uploads anything, so a stale or missing `dist/` cannot be published. It is a backstop for
steps 2–3, not a replacement: it does not run for `npm pack`, so steps 6–7 still need doing by
hand.

## 11. Post-publish verification

```
npm view nightshift-terminal version                       # the new version
TMP=$(mktemp -d); cd "$TMP" && npm init -y >/dev/null
npm install nightshift-terminal
./node_modules/.bin/nightshift --version              # the new version
```

- [ ] Installing **from the registry** (not the local tarball) works and runs.
- [ ] The npm package page shows the README and the repository link.
- [ ] `git push origin <branch> --follow-tags` has happened, so the published version is
      traceable to a commit.

---

## Rules that hold for every release

- **Never `npm publish` without explicit human authorization.** Step 10, in bold, twice.
- **Never force-push** a release branch or an already-pushed tag.
- Never weaken, skip, or delete a test to get a release out. The test count is a floor.
- Never publish from a dirty tree — `dist/` is gitignored, so uncommitted source means the
  published artifact does not correspond to any commit.
- `windows-latest` stays the only CI OS. Linux and macOS are not implemented
  (`docs/PLATFORM-COMPATIBILITY.md`), and a green badge for them would be a support claim.
