# Configuration formats

## NIGHTSHIFT's own config (`%APPDATA%\nightshift\config.json`)

```json
{
  "schemaVersion": "1.0",
  "activeThemeId": "ghost-protocol",
  "initializedAt": "2026-11-09T12:00:00.000Z"
}
```

Validated by `src/core/config/store.ts` via a Zod schema. Unknown/missing fields on load are
not silently coerced — `readConfig()` throws if the file doesn't parse against the schema.
0.1.0 files written before a field is added (e.g. `activeProfileId` in 0.2.0) must still load;
see the migration note in that release's section of `CHANGELOG.md`.

## Theme (`src/core/themes/schema.ts`)

See `README.md` "Theme format" for the full example. Required: `id`, `schemaVersion` (literal
`"1.0"`), `name`, `colors` (9 named hex colors), `ansi` (16 named hex colors). Optional:
`description`, `typography`, `effects`.

## Profile (`src/core/profiles/schema.ts`)

0.1.0: `id`, `schemaVersion` (literal `"1.0"`), `name`, `description?`, `themeId`.

Profiles reference a theme by id; they do not embed theme data. A profile is invalid if its
`themeId` does not resolve in the theme registry at validation time for commands that need
the theme (apply), but the schema itself only checks that `themeId` is a non-empty string —
theme existence is a registry-level check, not a schema-level one, so a profile can be listed
even if its theme later disappears (it just can't be applied).

## Windows Terminal `settings.json`

Not a NIGHTSHIFT format — this is Microsoft's own schema. NIGHTSHIFT only ever touches two
parts of it: the top-level `schemes` array (adds/replaces one entry by `name`) and
`profiles.defaults.colorScheme`/`profiles.defaults.font`. Every other key is round-tripped
unchanged. See `src/adapters/windows-terminal/apply.ts`.
