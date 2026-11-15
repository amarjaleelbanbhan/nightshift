import fs from "node:fs";
import * as jsonc from "jsonc-parser";
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

/**
 * A settings.json as it exists on disk: the exact text, so a write can edit it in place rather
 * than regenerate it, plus the parsed object the merge reasons about.
 *
 * Both halves are needed because the two jobs are different. Deciding *what* to change is a
 * question about values, which wants the object; performing the change without destroying the
 * comments, key order and indentation of a file NIGHTSHIFT does not own is a question about
 * text (#14).
 */
export interface SettingsFile {
  /** A UTF-8 BOM if the file had one, so writing it back does not silently drop it. */
  bom: string;
  /** The file's text, BOM removed. */
  text: string;
  settings: Record<string, unknown>;
}

/** "ValueExpected" -> "value expected", so a parse failure reads as a sentence. */
function describeParseError(code: jsonc.ParseErrorCode): string {
  return jsonc
    .printParseErrorCode(code)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

/**
 * Reads and parses settings.json as JSONC - the format Windows Terminal documents it as, and
 * the format its own generated file is in, comment header and all.
 *
 * Comments and trailing commas are therefore accepted rather than refused. They were refused
 * until `mergeThemeIntoSettingsText` existed, because reading them while writing with
 * `JSON.stringify` would have deleted them (#14).
 */
export function readWindowsTerminalSettingsFile(settingsPath: string): SettingsFile {
  // Separate a UTF-8 BOM rather than dropping it: it is legal in the file, every parser
  // rejects it outright, and re-attaching it on write keeps a file Notepad saved as
  // "UTF-8 with BOM" byte-compatible with the editor that wrote it.
  const raw = fs.readFileSync(settingsPath, "utf8");
  const bom = raw.startsWith("﻿") ? "﻿" : "";
  const text = raw.slice(bom.length);

  const errors: jsonc.ParseError[] = [];
  let parsed: unknown;
  try {
    // allowEmptyContent stays off: an empty settings.json is a broken settings.json, not `{}`.
    parsed = jsonc.parse(text, errors, { allowTrailingComma: true });
  } catch (error) {
    // `jsonc.parse` is a recursive-descent parser with no depth limit, where the `JSON.parse`
    // it replaced was V8's iterative one. A pathologically nested file (~10k deep, which is
    // only ~20 KB, and settings.json is deliberately read without a size cap) therefore throws
    // `RangeError: Maximum call stack size exceeded` where the old reader would have parsed it.
    // Nothing is written before this point, so the cost is a confusing message, not data loss -
    // which is what this rewrites.
    throw new Error(
      `"${settingsPath}" could not be parsed: ${(error as Error).message}. ` +
        "The file may be nested too deeply to read. Let Windows Terminal regenerate it.",
    );
  }
  if (errors.length > 0) {
    // jsonc recovers from errors and returns a partial value, so this must be checked rather
    // than caught - a truncated file would otherwise apply a theme to half its own contents.
    const first = errors[0]!;
    const line = text.slice(0, first.offset).split("\n").length;
    throw new Error(
      `"${settingsPath}" is not valid JSON: ${describeParseError(first.error)} at line ${line}. ` +
        "Fix the JSON syntax, or let Windows Terminal regenerate the file.",
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`"${settingsPath}" does not contain a JSON object at its root`);
  }
  return { bom, text, settings: parsed as Record<string, unknown> };
}

/** The parsed object only, for the callers that never write: `--dry-run` and verification. */
export function readWindowsTerminalSettings(settingsPath: string): Record<string, unknown> {
  return readWindowsTerminalSettingsFile(settingsPath).settings;
}

/**
 * Reuses the file's own indentation and line endings, so an edit to a 2-space, LF-formatted
 * settings.json does not come back indented 4 spaces with CRLF. Falls back to Windows
 * Terminal's own default (4 spaces) when the file has nothing indented to learn from.
 */
function detectFormatting(text: string): jsonc.FormattingOptions {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indent = /\n([ \t]+)[^\s]/.exec(text)?.[1];
  if (indent === undefined) return { insertSpaces: true, tabSize: 4, eol };
  return indent.startsWith("\t")
    ? { insertSpaces: false, tabSize: 4, eol }
    : { insertSpaces: true, tabSize: indent.length, eol };
}

function editValue(
  text: string,
  path: jsonc.JSONPath,
  value: unknown,
  formattingOptions: jsonc.FormattingOptions,
  isArrayInsertion = false,
): string {
  return jsonc.applyEdits(
    text,
    jsonc.modify(text, path, value, { formattingOptions, isArrayInsertion }),
  );
}

/**
 * Returns `file`'s text with `theme` applied, as a series of targeted edits to the keys the
 * merge touches - the matching `schemes` entry, `profiles.defaults.colorScheme` and the font.
 * Every byte outside those keys, including comments, key order and indentation, is the user's
 * and comes back unchanged.
 *
 * This replaced a `JSON.parse` -> merge -> `JSON.stringify` round trip, which could not
 * preserve comments at all and reordered nothing but also preserved nothing (#14). The same
 * object merge still runs first and is still the only authority on whether the file can be
 * rewritten at all - it throws on a legacy array `profiles`, a string `profiles.defaults` and
 * so on - so the refusals, the `--dry-run` preview and the write all continue to agree.
 */
export function mergeThemeIntoSettingsText(file: SettingsFile, theme: Theme): string {
  mergeThemeIntoSettings(file.settings, theme);

  const scheme = themeToColorScheme(theme);
  const formatting = detectFormatting(file.text);
  let text = file.text;

  const schemes = file.settings.schemes;
  if (!Array.isArray(schemes)) {
    // Matches the merge: a `schemes` that is absent, null or some other shape becomes a
    // one-entry list rather than being merged into.
    text = editValue(text, ["schemes"], [scheme], formatting);
  } else {
    // Every entry with this name, not just the first. The object merge filters out *all* of
    // them and appends one, so a file that already holds two entries called "Ghost Protocol"
    // (hand-edited, or left by an older run) must come out of the write holding one - a
    // `findIndex` that replaced only the first left the stale duplicate behind, and the
    // duplicate Windows Terminal would have honoured is whichever one it reads last.
    const matches = schemes.flatMap((s, i) => (isSchemeNamed(s, scheme.name) ? [i] : []));
    if (matches.length === 0) {
      text = editValue(text, ["schemes", schemes.length], scheme, formatting, true);
    } else {
      // Highest index first, so removing one does not shift the index of another.
      for (const extra of matches.slice(1).reverse()) {
        text = editValue(text, ["schemes", extra], undefined, formatting);
      }
      // Replaced in place rather than removed-and-appended. The merge's result ends up last
      // because it rebuilds the array; preserving the user's ordering is the point here, and
      // `--dry-run` compares the entry by name rather than by position, so the two agree.
      text = editValue(text, ["schemes", matches[0]!], scheme, formatting);
    }
  }

  text = editValue(text, ["profiles", "defaults", "colorScheme"], scheme.name, formatting);
  if (theme.typography) {
    text = editValue(
      text,
      ["profiles", "defaults", "font", "face"],
      theme.typography.family,
      formatting,
    );
    text = editValue(
      text,
      ["profiles", "defaults", "font", "size"],
      theme.typography.size,
      formatting,
    );
  }

  return file.bom + text;
}

/** Writes the text `mergeThemeIntoSettingsText` produced, atomically. */
export function writeWindowsTerminalSettings(settingsPath: string, text: string): void {
  atomicWriteFileSync(settingsPath, text);
}
