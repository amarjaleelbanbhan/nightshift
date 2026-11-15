import fs from "node:fs";
import path from "node:path";
import { builtinThemes, getBuiltinTheme } from "./builtin.js";
import { safeParseTheme, type Theme } from "./schema.js";
import { getUserThemesDir } from "../config/paths.js";
import { resolveSafePath } from "../../security/paths.js";
import { readJsonFileWithLimit } from "../../security/limits.js";

export interface ThemeListEntry {
  theme: Theme;
  source: "builtin" | "user";
}

function loadUserThemes(): ThemeListEntry[] {
  const dir = getUserThemesDir();
  if (!fs.existsSync(dir)) return [];

  const entries: ThemeListEntry[] = [];
  for (const fileName of fs.readdirSync(dir)) {
    if (!fileName.endsWith(".json")) continue;
    const filePath = resolveSafePath(dir, fileName);
    try {
      const result = safeParseTheme(readJsonFileWithLimit(filePath));
      if (result.success) {
        entries.push({ theme: result.data, source: "user" });
      }
    } catch {
      // Skip unreadable/malformed/oversized user theme files rather than crashing the CLI.
    }
  }
  return entries;
}

export function listThemes(): ThemeListEntry[] {
  const builtin: ThemeListEntry[] = builtinThemes.map((theme) => ({ theme, source: "builtin" }));
  return [...builtin, ...loadUserThemes()];
}

export function getTheme(id: string): Theme | undefined {
  const builtin = getBuiltinTheme(id);
  if (builtin) return builtin;
  return loadUserThemes().find((entry) => entry.theme.id === id)?.theme;
}

export function getUserThemesDirPath(): string {
  return path.resolve(getUserThemesDir());
}

/** Built-in theme ids ship with the package and can never be written to or removed. */
export function isBuiltinThemeId(id: string): boolean {
  return getBuiltinTheme(id) !== undefined;
}

/**
 * Whether a *user* theme file exists for `id`. Distinct from `getTheme(id) !== undefined`,
 * which also matches built-ins and ignores a file that exists but fails validation - both of
 * which matter to `theme create|remove`. Mirrors `userProfileFileExists` in the profile
 * registry.
 */
export function userThemeFileExists(id: string): boolean {
  return fs.existsSync(resolveSafePath(getUserThemesDir(), `${id}.json`));
}
