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

See `README.md` "Theme format" for the full example. Required: `id`, `schemaVersion` (literal
`"1.0"`), `name`, `colors` (9 named hex colors), `ansi` (16 named hex colors). Optional:
`description`, `typography`, `effects`.

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
