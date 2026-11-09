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

/**
 * Merges `theme` into a parsed Windows Terminal settings.json object,
 * preserving every unrelated key. Only `schemes` (the matching entry) and
 * `profiles.defaults.colorScheme`/font are touched.
 */
export function mergeThemeIntoSettings(
  settings: Record<string, unknown>,
  theme: Theme,
): Record<string, unknown> {
  const scheme = themeToColorScheme(theme);

  const existingSchemes = Array.isArray(settings.schemes)
    ? (settings.schemes as WindowsTerminalColorScheme[])
    : [];
  const withoutSameName = existingSchemes.filter((s) => s?.name !== scheme.name);
  const schemes = [...withoutSameName, scheme];

  const existingProfiles =
    typeof settings.profiles === "object" && settings.profiles !== null
      ? (settings.profiles as Record<string, unknown>)
      : {};
  const existingDefaults =
    typeof existingProfiles.defaults === "object" && existingProfiles.defaults !== null
      ? (existingProfiles.defaults as Record<string, unknown>)
      : {};

  const defaults: Record<string, unknown> = {
    ...existingDefaults,
    colorScheme: scheme.name,
  };
  if (theme.typography) {
    defaults.font = {
      ...(typeof existingDefaults.font === "object" && existingDefaults.font !== null
        ? (existingDefaults.font as Record<string, unknown>)
        : {}),
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
  const raw = fs.readFileSync(settingsPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
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
