import chalk from "chalk";
import { listProfiles, getProfile } from "../../core/profiles/registry.js";
import { importProfile, exportProfile, removeProfile } from "../../core/profiles/manager.js";
import { getTheme } from "../../core/themes/registry.js";
import {
  readConfig,
  isInitialized,
  initializeConfig,
  setActiveProfileAndTheme,
} from "../../core/config/store.js";
import { restoreBackup } from "../../backup/manager.js";
import { applyThemeFileOnly, type ApplyResult } from "./theme.js";

export function runProfileList(): void {
  const profiles = listProfiles();
  if (profiles.length === 0) {
    console.log(chalk.gray("No profiles found."));
    return;
  }
  const activeProfileId = isInitialized() ? readConfig().activeProfileId : null;

  console.log(chalk.bold("Available profiles:"));
  for (const { profile, source } of profiles) {
    const theme = getTheme(profile.themeId);
    const active = profile.id === activeProfileId ? chalk.green(" (active)") : "";
    console.log(`  ${chalk.cyan(profile.id.padEnd(24))} ${profile.name}${active} ${chalk.gray(`(${source})`)}`);
    if (profile.description) console.log(`  ${" ".repeat(24)} ${chalk.gray(profile.description)}`);
    console.log(
      `  ${" ".repeat(24)} ${chalk.gray(`theme: ${profile.themeId}${theme ? "" : " (missing!)"}`)}`,
    );
  }
}

export function runProfileShow(id: string): void {
  const entry = getProfile(id);
  if (!entry) {
    console.error(chalk.red(`No profile found with id "${id}". Run \`nightshift profile list\`.`));
    process.exitCode = 1;
    return;
  }
  const { profile, source } = entry;
  const theme = getTheme(profile.themeId);
  const activeProfileId = isInitialized() ? readConfig().activeProfileId : null;

  console.log(chalk.bold(profile.name));
  if (profile.description) console.log(chalk.gray(profile.description));
  console.log();
  console.log(`${chalk.gray("ID:")}       ${profile.id}`);
  console.log(`${chalk.gray("Source:")}   ${source}`);
  console.log(`${chalk.gray("Theme:")}    ${profile.themeId}${theme ? ` (${theme.name})` : chalk.red(" - not found")}`);
  console.log(`${chalk.gray("Active:")}   ${profile.id === activeProfileId ? "yes" : "no"}`);
}

/**
 * Applies a profile's theme using the shared theme-apply engine (backup/verify/rollback -
 * see applyThemeFileOnly in theme.ts), then atomically records both the active profile and
 * theme in a single config write so the two can never disagree.
 */
export function applyProfile(id: string): ApplyResult {
  const entry = getProfile(id);
  if (!entry) {
    return { ok: false, message: `No profile found with id "${id}".` };
  }
  const { profile } = entry;

  if (!getTheme(profile.themeId)) {
    return {
      ok: false,
      message: `Profile "${profile.id}" references theme "${profile.themeId}", which does not exist.`,
    };
  }

  const fileResult = applyThemeFileOnly(profile.themeId);
  if (!fileResult.ok) return fileResult;

  try {
    if (!isInitialized()) initializeConfig();
    setActiveProfileAndTheme(profile.id, profile.themeId);
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
      message: `Profile's theme was applied but updating NIGHTSHIFT's configuration failed, so the previous terminal settings were restored: ${(error as Error).message}`,
    };
  }

  return {
    ok: true,
    message: `Applied profile "${profile.name}" (theme "${profile.themeId}"). Backup id: ${fileResult.backupId}.`,
    backupId: fileResult.backupId,
  };
}

export function runProfileApply(id: string): void {
  const result = applyProfile(id);
  if (result.ok) {
    console.log(chalk.green(result.message));
  } else {
    console.error(chalk.red(result.message));
    process.exitCode = 1;
  }
}

export function runProfileImport(file: string, options: { overwrite?: boolean | undefined }): void {
  const result = importProfile(file, { overwrite: options.overwrite });
  if (result.ok) {
    console.log(chalk.green(result.message));
  } else {
    console.error(chalk.red(result.message));
    process.exitCode = 1;
  }
}

export function runProfileExport(
  id: string,
  options: { output?: string | undefined; overwrite?: boolean | undefined },
): void {
  const result = exportProfile(id, { outputPath: options.output, overwrite: options.overwrite });
  if (result.ok) {
    console.log(chalk.green(result.message));
  } else {
    console.error(chalk.red(result.message));
    process.exitCode = 1;
  }
}

export function runProfileRemove(id: string): void {
  const result = removeProfile(id);
  if (result.ok) {
    console.log(chalk.green(result.message));
  } else {
    console.error(chalk.red(result.message));
    process.exitCode = 1;
  }
}
