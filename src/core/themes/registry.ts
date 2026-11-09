import fs from "node:fs";
import path from "node:path";
import { builtinThemes, getBuiltinTheme } from "./builtin.js";
import { safeParseTheme, type Theme } from "./schema.js";
import { getUserThemesDir } from "../config/paths.js";
import { resolveSafePath } from "../../security/paths.js";

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
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const result = safeParseTheme(raw);
      if (result.success) {
        entries.push({ theme: result.data, source: "user" });
      }
    } catch {
      // Skip unreadable/malformed user theme files rather than crashing the CLI.
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
