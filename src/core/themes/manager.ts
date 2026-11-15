import fs from "node:fs";
import path from "node:path";
import { safeParseTheme, themeIdSchema, type Theme } from "./schema.js";
import { getTheme, isBuiltinThemeId, userThemeFileExists } from "./registry.js";
import { auditThemeContrast, type ContrastResult } from "./contrast.js";
import { getUserThemesDir } from "../config/paths.js";
import { resolveSafePath, assertNotSymlink } from "../../security/paths.js";
import { atomicWriteFileSync } from "../../utils/atomicWrite.js";
import { readConfig } from "../config/store.js";
import { MAX_JSON_FILE_BYTES } from "../../security/limits.js";

/**
 * Mutating theme operations: validate a candidate file, write a new user theme, remove one.
 *
 * Separate from `registry.ts`, which stays read-only, exactly as profiles split
 * `profiles/registry.ts` (read) from `profiles/manager.ts` (write). The rules enforced here -
 * never overwrite a built-in id under any flag, refuse an existing user file without
 * `--overwrite`, route every write through `resolveSafePath` + `atomicWriteFileSync` - are the
 * same rules `importProfile`/`removeProfile` already enforce, deliberately phrased the same way
 * so the two asset types cannot drift apart.
 *
 * Returns plain result objects and never prints; `src/cli/commands/theme.ts` does that.
 */

/** The theme cloned when `theme create` is given no `--from`. */
export const DEFAULT_BASE_THEME_ID = "ghost-protocol";

export interface ThemeFileResult {
  ok: boolean;
  message: string;
  theme?: Theme | undefined;
  path?: string | undefined;
}

export interface ThemeIssue {
  /** Dotted field path, or `(root)` for a whole-document problem. */
  path: string;
  message: string;
}

export interface ThemeValidationResult {
  ok: boolean;
  message: string;
  /** Every schema issue, not just the first - a half-reported file costs a second round trip. */
  issues: ThemeIssue[];
  /**
   * Colors below WCAG AA for body text. Advisory only: these never set `ok` to false, because
   * a low-contrast theme is a valid theme that happens to be hard to read, and failing it would
   * make `validate` unusable for the deliberately-dim themes people actually write.
   */
  warnings: ContrastResult[];
  theme?: Theme | undefined;
}

function toIssues(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): ThemeIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));
}

/**
 * Validates an arbitrary JSON file against `themeSchema`.
 *
 * The size cap is checked with an explicit `stat` rather than via `readJsonFileWithLimit`
 * because that throws `FileTooLargeError`, which the exit-code contract maps to code 2 ("my own
 * config.json is broken") - wrong for a file the user just pointed at. Same reasoning as
 * `importProfile`.
 */
export function validateThemeFile(sourcePath: string): ThemeValidationResult {
  const empty = { issues: [] as ThemeIssue[], warnings: [] as ContrastResult[] };
  const resolved = path.resolve(process.cwd(), sourcePath);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false, message: `No file found at "${sourcePath}".`, ...empty };
  }
  if (!stat.isFile()) {
    return { ok: false, message: `"${sourcePath}" is not a regular file.`, ...empty };
  }
  if (stat.size > MAX_JSON_FILE_BYTES) {
    return {
      ok: false,
      message: `"${sourcePath}" is ${stat.size} bytes, which exceeds the ${MAX_JSON_FILE_BYTES}-byte limit for NIGHTSHIFT JSON files.`,
      ...empty,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (error) {
    return {
      ok: false,
      message: `"${sourcePath}" is not valid JSON: ${(error as Error).message}`,
      ...empty,
    };
  }

  const result = safeParseTheme(raw);
  if (!result.success) {
    const issues = toIssues(result.error);
    return {
      ok: false,
      message: `"${sourcePath}" is not a valid theme (${issues.length} issue${issues.length === 1 ? "" : "s"}).`,
      issues,
      warnings: [],
    };
  }

  const theme = result.data;
  return {
    ok: true,
    message: `"${theme.name}" (${theme.id}) is a valid theme.`,
    issues: [],
    warnings: auditThemeContrast(theme).filter((r) => !r.passesBody),
    theme,
  };
}

/**
 * Writes a new user theme by cloning an existing one and replacing its identity.
 *
 * Cloning rather than generating from scratch: a theme is nine semantic colors plus all 16 ANSI
 * entries, and an empty skeleton would fail its own schema. Starting from a working theme means
 * the file is valid and applyable the moment it is written, and `theme create` then
 * `theme apply` works with no hand-editing in between.
 */
export function createTheme(options: {
  id: string;
  name: string;
  from?: string | undefined;
  description?: string | undefined;
  overwrite?: boolean | undefined;
}): ThemeFileResult {
  const baseId = options.from ?? DEFAULT_BASE_THEME_ID;
  const base = getTheme(baseId);
  if (!base) {
    return {
      ok: false,
      message: `No theme found with id "${baseId}" to use as a starting point.`,
    };
  }

  const candidate: Theme = {
    ...base,
    id: options.id,
    name: options.name,
    // The base's description describes the base, not the clone, so it is replaced or dropped
    // rather than inherited - an inherited one would be actively misleading in `theme list`.
    ...(options.description ? { description: options.description } : {}),
  };
  if (!options.description) delete (candidate as { description?: string }).description;

  // Schema first: it is what reports a bad id as a bad id. Doing the path work first would
  // report `--id ../../evil` as a path-traversal attempt, which is true but less useful.
  const parsed = safeParseTheme(candidate);
  if (!parsed.success) {
    const issues = toIssues(parsed.error);
    return {
      ok: false,
      message: `Invalid theme:\n  ${issues.map((i) => `${i.path}: ${i.message}`).join("\n  ")}`,
    };
  }
  const theme = parsed.data;

  // Checked before --overwrite is consulted: no flag may replace a built-in theme, because the
  // built-ins ship inside the package and a user file shadowing one would be un-undoable from
  // the CLI. Same rule as `importProfile`.
  if (isBuiltinThemeId(theme.id)) {
    return {
      ok: false,
      message: `"${theme.id}" is a built-in theme id and cannot be overwritten.`,
    };
  }

  if (userThemeFileExists(theme.id) && !options.overwrite) {
    return {
      ok: false,
      message: `A user theme with id "${theme.id}" already exists. Re-run with --overwrite to replace it.`,
    };
  }

  const destDir = getUserThemesDir();
  const destPath = resolveSafePath(destDir, `${theme.id}.json`);
  try {
    assertNotSymlink(destPath);
    fs.mkdirSync(destDir, { recursive: true });
    atomicWriteFileSync(destPath, JSON.stringify(theme, null, 2));
  } catch (error) {
    return { ok: false, message: `Failed to write the new theme: ${(error as Error).message}` };
  }

  return {
    ok: true,
    message: `Created theme "${theme.id}" from "${baseId}".`,
    theme,
    path: destPath,
  };
}

/** Removes a user theme. Built-ins and the active theme are refused. */
export function removeTheme(id: string): ThemeFileResult {
  // Same reason as createTheme: diagnose a malformed id as a malformed id before it is turned
  // into a path. `userThemeFileExists` would otherwise throw UnsafePathError for `../../evil`.
  const validId = themeIdSchema.safeParse(id);
  if (!validId.success) {
    return {
      ok: false,
      message: `"${id}" is not a valid theme id (${validId.error.issues[0]?.message ?? "invalid"}).`,
    };
  }

  if (isBuiltinThemeId(id)) {
    return { ok: false, message: `"${id}" is a built-in theme and cannot be removed.` };
  }
  if (!userThemeFileExists(id)) {
    return { ok: false, message: `No user theme found with id "${id}".` };
  }

  // Read the config *before* unlinking. `removeProfile` had this the other way round, so a
  // corrupt config.json left the file already deleted and the config not updated (A-10).
  if (readConfig().activeThemeId === id) {
    return {
      ok: false,
      message: `"${id}" is the active theme and cannot be removed.`,
    };
  }

  fs.unlinkSync(resolveSafePath(getUserThemesDir(), `${id}.json`));
  return { ok: true, message: `Removed theme "${id}".` };
}
