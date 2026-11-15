import { getTheme } from "./registry.js";
import { detectCapabilities } from "../capabilities/detect.js";
import { setActiveTheme, isInitialized, initializeConfig } from "../config/store.js";
import { createBackup, restoreBackup } from "../../backup/manager.js";
import {
  readWindowsTerminalSettings,
  writeWindowsTerminalSettings,
  mergeThemeIntoSettings,
} from "../../adapters/windows-terminal/apply.js";
import {
  resolveSettingsTarget,
  describeSettingsTarget,
} from "../../adapters/windows-terminal/locate.js";

/**
 * The theme-application engine: it orchestrates the Windows Terminal adapter, the backup
 * engine, and NIGHTSHIFT's own config, and returns a plain result object. It does not print -
 * `src/cli/commands/theme.ts` and `src/cli/commands/profile.ts` do that.
 *
 * This used to live inside `src/cli/commands/theme.ts`, which made a command module
 * load-bearing infrastructure for two other callers and mixed adapter orchestration with
 * presentation in one file about to gain three more commands (A-6 in
 * `docs/development/ARCHITECTURE_AUDIT.md`).
 */
export interface ApplyResult {
  ok: boolean;
  message: string;
  backupId?: string | undefined;
}

/**
 * Backs up, merges, writes, and verifies a theme against Windows Terminal's settings.json -
 * without touching NIGHTSHIFT's own active-state config. Profile apply reuses this exact
 * backup/verify/rollback engine instead of a second implementation.
 */
export function applyThemeFileOnly(id: string): ApplyResult {
  const theme = getTheme(id);
  if (!theme) {
    return { ok: false, message: `No theme found with id "${id}".` };
  }

  const caps = detectCapabilities();
  const located = caps.windowsTerminal.settingsPath;
  if (!located) {
    return {
      ok: false,
      message:
        "Windows Terminal settings.json was not found. Is Windows Terminal installed? " +
        "(Theme application is currently Windows-only.)",
    };
  }

  // Resolve before anything is read, backed up or written, so a symlinked settings.json is
  // followed to the file it points at instead of being renamed over (#27). Everything below -
  // including `createBackup`, so a rollback restores to the place the content actually lives -
  // uses the resolved path; the message names both.
  const target = resolveSettingsTarget(located);
  const settingsPath = target.path;

  let backup: ReturnType<typeof createBackup>;
  try {
    backup = createBackup(settingsPath, `apply theme ${theme.id}`);
  } catch (error) {
    return {
      ok: false,
      message: `Failed to create a backup before applying the theme: ${(error as Error).message}`,
    };
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
    message: `Applied "${theme.name}" to Windows Terminal (${describeSettingsTarget(target)}).`,
    backupId: backup.id,
  };
}

/**
 * Records NIGHTSHIFT's active state after a successful file apply, restoring the terminal
 * backup if the config write fails so the two can never end up out of sync.
 *
 * One implementation, two callers: theme apply and profile apply were two copies of this same
 * sequence (A-5). This is the rollback path that protects the user's `settings.json`, so a fix
 * applied to one copy and not the other was the real risk - not the duplication itself.
 *
 * `subject` names what was applied, for the failure message; `success` is the caller's own
 * success message, which differs between the two (a theme reports the theme, a profile reports
 * the profile); `record` performs the config write.
 */
export function recordActiveState(
  fileResult: ApplyResult,
  options: { subject: string; success: string; record: () => void },
): ApplyResult {
  try {
    if (!isInitialized()) initializeConfig();
    options.record();
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
      message:
        `${options.subject} was applied but updating NIGHTSHIFT's configuration failed, ` +
        `so the previous terminal settings were restored: ${(error as Error).message}`,
    };
  }

  return { ok: true, message: options.success, backupId: fileResult.backupId };
}

/**
 * Applies a theme to Windows Terminal following the discover -> validate -> detect -> backup ->
 * apply -> verify -> report sequence, then persists it as NIGHTSHIFT's active theme. If the
 * config update itself fails, the terminal backup is restored too.
 */
export function applyThemeToWindowsTerminal(id: string): ApplyResult {
  const fileResult = applyThemeFileOnly(id);
  if (!fileResult.ok) return fileResult;

  return recordActiveState(fileResult, {
    subject: "Theme",
    success: `${fileResult.message} Backup id: ${fileResult.backupId}.`,
    record: () => setActiveTheme(id),
  });
}
