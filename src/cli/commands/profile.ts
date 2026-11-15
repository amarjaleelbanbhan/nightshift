import chalk from "chalk";
import { listProfiles, getProfile } from "../../core/profiles/registry.js";
import { importProfile, exportProfile, removeProfile } from "../../core/profiles/manager.js";
import { getTheme } from "../../core/themes/registry.js";
import { tryReadConfig, setActiveProfileAndTheme } from "../../core/config/store.js";
import {
  applyThemeFileOnly,
  recordActiveState,
  type ApplyResult,
} from "../../core/themes/apply.js";
import { renderTable } from "../ui/table.js";
import { failWith, successMessage, warnMessage, emptyState } from "../ui/feedback.js";
import { reportConfigCorrupt } from "../errors.js";

/**
 * The active profile id, or null. A corrupt `config.json` degrades to "no active profile" and
 * is reported on stderr with a non-zero exit code rather than aborting: listing and inspecting
 * profiles must keep working when the config is the broken thing.
 */
function activeProfileIdOrWarn(): string | null {
  const result = tryReadConfig();
  if (result.ok) return result.config.activeProfileId;
  reportConfigCorrupt(result.error);
  return null;
}

export function runProfileList(): void {
  const profiles = listProfiles();
  if (profiles.length === 0) {
    console.log(
      emptyState(
        "No profiles found.",
        "Run `nightshift profile import <file>` to add one, or reinstall NIGHTSHIFT to restore the bundled profiles.",
      ),
    );
    return;
  }
  const activeProfileId = activeProfileIdOrWarn();

  console.log(
    renderTable(
      ["ID", "Name", "Theme", "Source"],
      profiles.map(({ profile, source }) => {
        const theme = getTheme(profile.themeId);
        const activeTag = profile.id === activeProfileId ? ` ${chalk.green("(active)")}` : "";
        const name = profile.description
          ? `${profile.name}${activeTag}\n${chalk.gray(profile.description)}`
          : `${profile.name}${activeTag}`;
        return [
          chalk.cyan(profile.id),
          name,
          theme ? theme.name : chalk.red(`${profile.themeId} (missing!)`),
          chalk.gray(source),
        ];
      }),
    ),
  );
}

export function runProfileShow(id: string): void {
  const entry = getProfile(id);
  if (!entry) {
    failWith(
      `No profile found with id "${id}".`,
      "Run `nightshift profile list` to see available profile ids.",
    );
    return;
  }
  const { profile, source } = entry;
  const theme = getTheme(profile.themeId);
  const activeProfileId = activeProfileIdOrWarn();

  console.log(chalk.bold(profile.name));
  if (profile.description) console.log(chalk.gray(profile.description));
  console.log();
  console.log(`${chalk.gray("ID:")}       ${profile.id}`);
  console.log(`${chalk.gray("Source:")}   ${source}`);
  console.log(
    `${chalk.gray("Theme:")}    ${profile.themeId}${theme ? ` (${theme.name})` : chalk.red(" - not found")}`,
  );
  console.log(`${chalk.gray("Active:")}   ${profile.id === activeProfileId ? "yes" : "no"}`);
}

/**
 * Applies a profile's theme using the shared theme-apply engine (backup/verify/rollback -
 * see `src/core/themes/apply.ts`), then atomically records both the active profile and theme
 * in a single config write so the two can never disagree. The rollback-on-config-failure path
 * is `recordActiveState`, shared with theme apply rather than duplicated here.
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

  return recordActiveState(fileResult, {
    subject: "Profile's theme",
    success: `Applied profile "${profile.name}" (theme "${profile.themeId}"). Backup id: ${fileResult.backupId}.`,
    record: () => setActiveProfileAndTheme(profile.id, profile.themeId),
  });
}

export function runProfileApply(id: string): void {
  const result = applyProfile(id);
  if (result.ok) {
    console.log(successMessage(result.message));
  } else {
    failWith(
      result.message,
      "Run `nightshift profile list` to see available profiles, or `nightshift doctor` to check your environment.",
    );
  }
}

export function runProfileImport(file: string, options: { overwrite?: boolean | undefined }): void {
  const result = importProfile(file, { overwrite: options.overwrite });
  if (result.ok) {
    console.log(successMessage(result.message));
    return;
  }
  // The built-in-id refusal is the one import failure the generic hint actively misdirected on:
  // it recommended `profile export`, which is the command that *produced* the rejected file, so
  // a user following the hint re-exported, re-imported and got the identical error (#29). The
  // refusal stays; the hint now names the edit that resolves it.
  failWith(
    result.message,
    result.message.includes("is a built-in profile id")
      ? 'Change the "id" field in that file to an id of your own, then re-run - built-in ids are shipped with NIGHTSHIFT and cannot be replaced.'
      : "Check the file path and that its contents match the profile format - `nightshift profile export <id>` writes a valid example to copy.",
  );
}

export function runProfileExport(
  id: string,
  options: { output?: string | undefined; overwrite?: boolean | undefined },
): void {
  const result = exportProfile(id, { outputPath: options.output, overwrite: options.overwrite });
  if (result.ok) {
    console.log(successMessage(result.message));
    if (result.warning) console.log(warnMessage(result.warning));
  } else {
    failWith(
      result.message,
      "Run `nightshift profile list` to see available profile ids, or re-run with --overwrite to replace an existing file.",
    );
  }
}

export function runProfileRemove(id: string): void {
  const result = removeProfile(id);
  if (result.ok) {
    console.log(successMessage(result.message));
  } else {
    failWith(
      result.message,
      "Run `nightshift profile list` to see which profiles are user-imported - built-in profiles cannot be removed.",
    );
  }
}
