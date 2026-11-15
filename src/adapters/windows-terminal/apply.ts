import fs from "node:fs";
import type { Theme } from "../../core/themes/schema.js";
import { atomicWriteFileSync } from "../../utils/atomicWrite.js";

interface WindowsTerminalColorScheme {
  name: string;
  background: string;
  foreground: string;
  cursorColor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  purple: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightPurple: string;
  brightCyan: string;
  brightWhite: string;
}

function themeToColorScheme(theme: Theme): WindowsTerminalColorScheme {
  return {
    name: theme.name,
    background: theme.colors.background,
    foreground: theme.colors.foreground,
    cursorColor: theme.colors.cursor,
    selectionBackground: theme.colors.selection,
    ...theme.ansi,
  };
}

/** True only for a plain object whose `name` is exactly the string `name`. */
function isSchemeNamed(candidate: unknown, name: string): boolean {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    (candidate as { name?: unknown }).name === name
  );
}

/**
 * Returns `value` as a plain object, `{}` when the key is absent, and **throws** when the key
 * is present in any other shape.
 *
 * Refusing rather than coercing is the whole point (G25). Every one of these containers used
 * to be object-spread behind a `typeof === "object"` test, so:
 *   - `profiles: [a, b]` - Windows Terminal's legacy root-array form - became
 *     `{"0": a, "1": b}`, destroying the user's entire profile list while reporting success;
 *   - `profiles: "Campbell"` was silently replaced by `{ defaults: ... }`, discarding it.
 *
 * NIGHTSHIFT does not guess at a migration of someone's terminal profile list. Declining is
 * recoverable (Windows Terminal migrates the legacy form itself when its settings UI opens);
 * a silent rewrite is not. `applyThemeFileOnly` already backs up before calling this and rolls
 * back on any throw, so refusing costs the caller nothing.
 */
function requirePlainObject(value: unknown, keyPath: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (Array.isArray(value)) {
    throw new Error(
      `Windows Terminal's "${keyPath}" is a JSON array (the legacy pre-1.0 settings format). ` +
        "NIGHTSHIFT will not rewrite it, because converting it to the current " +
        "{ defaults, list } form would mean guessing at a migration of your whole profile " +
        "list. Open Windows Terminal's settings UI once to let it migrate the file, then " +
        "re-run this command.",
    );
  }
  if (typeof value !== "object" || value === null) {
    throw new Error(
      `Windows Terminal's "${keyPath}" is ${value === null ? "null" : `a ${typeof value}`}, ` +
        "not an object. NIGHTSHIFT will not rewrite a settings.json whose structure it cannot " +
        `interpret - fix or remove "${keyPath}", then re-run this command.`,
    );
  }
  return value as Record<string, unknown>;
}

/**
 * Merges `theme` into a parsed Windows Terminal settings.json object,
 * preserving every unrelated key. Only `schemes` (the matching entry) and
 * `profiles.defaults.colorScheme`/font are touched.
 *
 * Throws rather than returning a result object: the only caller
 * (`applyThemeFileOnly` in `src/core/themes/apply.ts`) wraps it in the backup/rollback
 * sequence, so a throw already lands on the safe path.
 */
export function mergeThemeIntoSettings(
  settings: Record<string, unknown>,
  theme: Theme,
): Record<string, unknown> {
  const scheme = themeToColorScheme(theme);

  // settings.json is user-owned and may legitimately be in any shape, including shapes
  // Windows Terminal itself would reject. `schemes` is therefore typed as unknown[] rather
  // than cast to WindowsTerminalColorScheme[]: a non-array `schemes` (null, a string, an
  // object) becomes an empty list, and non-object elements (null, strings, numbers, nested
  // arrays) are passed through untouched rather than having `.name` read off them. They are
  // kept, not dropped - NIGHTSHIFT does not delete data it does not understand.
  const existingSchemes: unknown[] = Array.isArray(settings.schemes) ? settings.schemes : [];
  const withoutSameName = existingSchemes.filter((s) => !isSchemeNamed(s, scheme.name));
  const schemes = [...withoutSameName, scheme];

  const existingProfiles = requirePlainObject(settings.profiles, "profiles");
  const existingDefaults = requirePlainObject(existingProfiles.defaults, "profiles.defaults");

  const defaults: Record<string, unknown> = {
    ...existingDefaults,
    colorScheme: scheme.name,
  };
  if (theme.typography) {
    defaults.font = {
      ...requirePlainObject(existingDefaults.font, "profiles.defaults.font"),
      face: theme.typography.family,
      size: theme.typography.size,
    };
  }

  return {
    ...settings,
    schemes,
    profiles: {
      ...existingProfiles,
      defaults,
    },
  };
}

export function readWindowsTerminalSettings(settingsPath: string): Record<string, unknown> {
  // Strip a UTF-8 BOM: it is legal in the file and JSON.parse rejects it outright, so a
  // settings.json saved once by Notepad as "UTF-8 with BOM" failed every theme apply with
  // `Unexpected token '﻿'`.
  const raw = fs.readFileSync(settingsPath, "utf8").replace(/^﻿/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // Windows Terminal documents settings.json as JSONC and its own generated file has
    // carried a `//` comment header. NIGHTSHIFT writes via JSON.stringify, which cannot
    // round-trip comments, so it names the real problem instead of relaying
    // `Unexpected token '/'`. The pattern requires the `//` to open a line, so a URL inside
    // a string value (`"$help": "https://..."`) is not mistaken for a comment.
    const detail = /(?:^|\n)\s*\/\//.test(raw)
      ? " It appears to contain `//` comments, which Windows Terminal allows. NIGHTSHIFT " +
        "cannot rewrite a commented settings.json without discarding the comments, so it " +
        "will not try - remove them to apply a theme."
      : " Fix the JSON syntax, or let Windows Terminal regenerate the file.";
    throw new Error(`"${settingsPath}" is not valid JSON: ${(error as Error).message}.${detail}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`"${settingsPath}" does not contain a JSON object at its root`);
  }
  return parsed as Record<string, unknown>;
}

export function writeWindowsTerminalSettings(
  settingsPath: string,
  settings: Record<string, unknown>,
): void {
  atomicWriteFileSync(settingsPath, JSON.stringify(settings, null, 4));
}
