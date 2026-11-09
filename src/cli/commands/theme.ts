import chalk from "chalk";
import { listThemes, getTheme } from "../../core/themes/registry.js";
import { detectCapabilities } from "../../core/capabilities/detect.js";
import { setActiveTheme, isInitialized, initializeConfig, readConfig } from "../../core/config/store.js";
import { createBackup, restoreBackup } from "../../backup/manager.js";
import {
  readWindowsTerminalSettings,
  writeWindowsTerminalSettings,
  mergeThemeIntoSettings,
} from "../../adapters/windows-terminal/apply.js";
import { renderTable } from "../ui/table.js";

export function runThemeList(): void {
  const entries = listThemes();
  const activeThemeId = isInitialized() ? readConfig().activeThemeId : null;

  console.log(
    renderTable(
      ["", "ID", "Name", "Source"],
      entries.map(({ theme, source }) => {
        const activeTag = theme.id === activeThemeId ? ` ${chalk.green("(active)")}` : "";
        const name = theme.description ? `${theme.name}${activeTag}\n${chalk.gray(theme.description)}` : `${theme.name}${activeTag}`;
        return [chalk.hex(theme.colors.primary)("■"), chalk.cyan(theme.id), name, chalk.gray(source)];
      }),
    ),
  );
}

export function runThemePreview(id: string): void {
  const theme = getTheme(id);
  if (!theme) {
    console.error(chalk.red(`No theme found with id "${id}". Run \`nightshift theme list\`.`));
    process.exitCode = 1;
    return;
  }

  const swatch = (hex: string, label: string) => chalk.bgHex(hex).hex("#000000")(` ${label} `);
  console.log(chalk.bold(theme.name));
  if (theme.description) console.log(chalk.gray(theme.description));
  console.log();
  console.log(
    [
      swatch(theme.colors.background, "bg"),
      swatch(theme.colors.foreground, "fg"),
      swatch(theme.colors.primary, "primary"),
      swatch(theme.colors.secondary, "secondary"),
      swatch(theme.colors.success, "success"),
      swatch(theme.colors.warning, "warning"),
      swatch(theme.colors.error, "error"),
    ].join(" "),
  );
}

export interface ApplyResult {
  ok: boolean;
  message: string;
  backupId?: string | undefined;
}

/**
 * Backs up, merges, writes, and verifies a theme against Windows Terminal's settings.json -
 * without touching NIGHTSHIFT's own active-state config. Exported so profile apply (see
 * src/cli/commands/profile.ts) reuses this exact backup/verify/rollback engine instead of
 * a second implementation.
 */
export function applyThemeFileOnly(id: string): ApplyResult {
  const theme = getTheme(id);
  if (!theme) {
    return { ok: false, message: `No theme found with id "${id}".` };
  }

  const caps = detectCapabilities();
  const settingsPath = caps.windowsTerminal.settingsPath;
  if (!settingsPath) {
    return {
      ok: false,
      message:
        "Windows Terminal settings.json was not found. Is Windows Terminal installed? " +
        "(Theme application is currently Windows-only.)",
    };
  }

  let backup: ReturnType<typeof createBackup>;
  try {
    backup = createBackup(settingsPath, `apply theme ${theme.id}`);
  } catch (error) {
    return { ok: false, message: `Failed to create a backup before applying the theme: ${(error as Error).message}` };
  }

  try {
    const current = readWindowsTerminalSettings(settingsPath);
    const merged = mergeThemeIntoSettings(current, theme);
    writeWindowsTerminalSettings(settingsPath, merged);

    const verification = readWindowsTerminalSettings(settingsPath);
    const schemes = verification.schemes;
    const applied = Array.isArray(schemes) && schemes.some((s) => s?.name === theme.name);
    if (!applied) {
      throw new Error("verification failed: color scheme not present after write");
    }
  } catch (error) {
    // Roll back on any failure so the user's settings.json is never left broken.
    try {
      restoreBackup(backup.id);
    } catch {
      // If restore itself fails, surface the original error below.
    }
    return {
      ok: false,
      message: `Failed to apply theme and restored previous settings: ${(error as Error).message}`,
    };
  }

  return {
    ok: true,
    message: `Applied "${theme.name}" to Windows Terminal (${settingsPath}).`,
    backupId: backup.id,
  };
}

/**
 * Applies a theme to Windows Terminal following the discover -> validate ->
 * detect -> backup -> apply -> verify -> report sequence, then persists it as
 * NIGHTSHIFT's active theme. If the config update itself fails, the terminal
 * backup is restored too, so the two never end up out of sync.
 */
export function applyThemeToWindowsTerminal(id: string): ApplyResult {
  const fileResult = applyThemeFileOnly(id);
  if (!fileResult.ok) return fileResult;

  try {
    if (!isInitialized()) initializeConfig();
    setActiveTheme(id);
  } catch (error) {
    if (fileResult.backupId) {
      try {
        restoreBackup(fileResult.backupId);
      } catch {
        // Best effort - the original error is still reported below.
      }
    }
    return {
      ok: false,
      message: `Theme was applied but updating NIGHTSHIFT's configuration failed, so the previous terminal settings were restored: ${(error as Error).message}`,
    };
  }

  return {
    ok: true,
    message: `${fileResult.message} Backup id: ${fileResult.backupId}.`,
    backupId: fileResult.backupId,
  };
}

export function runThemeApply(id: string): void {
  const result = applyThemeToWindowsTerminal(id);
  if (result.ok) {
    console.log(chalk.green(result.message));
  } else {
    console.error(chalk.red(result.message));
    process.exitCode = 1;
  }
}
