# Configuration formats

## NIGHTSHIFT's own config (`%APPDATA%\nightshift\config.json`)

```json
{
  "schemaVersion": "1.0",
  "activeThemeId": "ghost-protocol",
  "activeProfileId": "ghost-protocol-default",
  "initializedAt": "2026-11-09T12:00:00.000Z"
}
```

Validated by `src/core/config/store.ts` via a Zod schema. Unknown/missing fields on load are
not silently coerced — `readConfig()` throws if the file doesn't parse against the schema,
**except** `activeProfileId`, which uses `.default(null)` specifically so a 0.1.0 config file
written before that field existed still loads (with the field treated as `null`) rather than
failing validation. This is the additive-and-backward-compatible pattern to follow for any
future field added to this schema: default it, don't require a migration step.

Applying a theme directly (`theme apply`) sets `activeThemeId` and resets `activeProfileId` to
`null` — otherwise `status` would keep showing a profile as active after its theme was
overridden standalone. Applying a profile (`profile apply`) sets both fields in one atomic
write via `setActiveProfileAndTheme`.

## Theme (`src/core/themes/schema.ts`)

See `README.md` "Theme format" for the full example — it is a complete, valid file, verified by
running `theme validate` on the JSON block extracted from the README itself. Required: `id`
(lowercase letters, digits, hyphens), `schemaVersion` (literal `"1.0"`), `name`, `colors` (9
named hex colors), `ansi` (16 named hex colors). Optional: `description`, `typography`,
`effects`.

There is no shorthand for `ansi` and no defaulting: all 16 keys are required, and a file missing
them fails with one issue per missing key. This is why the README example is written out in full
rather than abbreviated — the abbreviation was a 16-error paste for anyone who copied it.

User themes live in `%APPDATA%\nightshift\themes\<id>.json`. That directory is written by
`theme create` (which clones an existing theme, so the result is valid immediately) and read by
the registry; files placed there by hand are validated on load and skipped if they fail.

`theme validate <file>` is the standalone validator: it reports every schema issue with its
dotted field path rather than stopping at the first, and exits `1` on an invalid file. Contrast
findings are reported separately with a different glyph and never set the exit code — a
low-contrast theme is a valid theme that happens to be hard to read, and failing it would make
`validate` unusable for the deliberately-dim themes people actually write.

A built-in theme id (`ghost-protocol`, `monolith`, `redline`, `deep-space`) can never be
written or removed by `theme create`/`theme remove`, with or without `--overwrite`: the
built-ins ship inside the package, so a user file shadowing one would be un-undoable from the
CLI. `theme remove` additionally refuses the *active* theme, and reads the config before
unlinking anything, so a corrupt config cannot leave the file deleted and the config not
updated.

## Profile (`src/core/profiles/schema.ts`)

0.2.0: `id`, `schemaVersion` (literal `"1.0"`), `name`, `description?`, `themeId`. The schema
is `.strict()` — an unexpected field (e.g. a `widgets` array someone copies in from a future
version) fails validation rather than being silently dropped.

Profiles reference a theme by id; they do not embed theme data. The schema itself only checks
that `themeId` is a non-empty string — theme *existence* is checked at the point of use
(import rejects an unknown theme reference up front; `apply`/`show` resolve it at call time),
not at parse time. This means a profile can still be listed even if its theme later
disappears from the registry (it just can't be applied) — see the "drifted" scenario covered
in `tests/integration/profile-apply.test.ts`.

Bundled profiles live in `profiles/*.json` (shipped with the package). User-imported profiles
live in `%APPDATA%\nightshift\profiles\*.json`. A user profile id that collides with a bundled
one is excluded from the list entirely (bundled wins, no silent shadowing) — `profile import`
already refuses this at import time, so reaching the registry-level exclusion means a file was
placed by hand.

## Windows Terminal `settings.json`

Not a NIGHTSHIFT format — this is Microsoft's own schema. NIGHTSHIFT only ever touches two
parts of it: the top-level `schemes` array (adds/replaces one entry by `name`) and
`profiles.defaults.colorScheme`/`profiles.defaults.font`. Every other key is round-tripped
unchanged. See `src/adapters/windows-terminal/apply.ts`.

Two shapes of this file are **refused rather than rewritten**, because a wrong guess here
destroys user data and declining does not:

- **`profiles` (or `profiles.defaults`, or `profiles.defaults.font`) is not a plain object.**
  The pre-1.0 Windows Terminal format put a JSON *array* at `profiles`. That used to be
  object-spread into `{"0": …, "1": …}`, destroying the entire profile list while reporting
  success. It is now refused with a message telling the user to open Windows Terminal's
  settings UI once, which migrates the file properly. Declining is recoverable; a silent
  rewrite is not.
A UTF-8 BOM *is* handled (separated before parsing, re-attached on write) rather than refused:
Notepad saving the file once as "UTF-8 with BOM" is common and the fix is unambiguous.

**Comments and trailing commas are read and preserved** (#14). The file is parsed as JSONC with
`jsonc-parser`, and the write is a set of targeted text edits to the keys that change rather
than a `JSON.stringify` of a rebuilt object — so comments, key order, indentation width and
line endings all come out of the write as they went in, and re-applying an already-applied
theme produces a byte-identical file. The edited region is reformatted to the file's own
indentation, which is the one visible cosmetic change: a one-line scheme entry expands across
lines, and a same-line trailing comment on the last key of an object that gains a key moves to
the end of that object. No comment text is lost.

A non-array `schemes` becomes an empty list rather than an error, and non-object entries inside
it are passed through untouched instead of having `.name` read off them. They are kept, not
dropped — NIGHTSHIFT does not delete data it cannot interpret.

## Fonts

Not a configuration format — there is nothing to write. `src/core/fonts/detect.ts` reads
installed families out of `%LOCALAPPDATA%\Microsoft\Windows\Fonts` (this user) and
`%WINDIR%\Fonts` (all users) by parsing each font file's sfnt `name` table. It reports
`unsupported` on non-Windows platforms and `unknown` when neither directory can be located,
rather than returning an empty list that would read as "no fonts installed".

A theme's `typography.family` is matched against this list by `doctor`; nothing writes to a
font directory, because font installation is not implemented.
