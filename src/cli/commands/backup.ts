import chalk from "chalk";
import { createBackup, listBackups, restoreBackup } from "../../backup/manager.js";
import { detectCapabilities } from "../../core/capabilities/detect.js";
import {
  resolveSettingsTarget,
  describeSettingsTarget,
} from "../../adapters/windows-terminal/locate.js";
import { renderTable } from "../ui/table.js";
import { failWith, successMessage, emptyState } from "../ui/feedback.js";
import { NightshiftError, EXIT_FAILURE } from "../errors.js";

export function runBackupCreate(): void {
  const caps = detectCapabilities();
  const located = caps.windowsTerminal.settingsPath;
  if (!located) {
    failWith(
      "No Windows Terminal settings.json detected to back up.",
      "Run `nightshift doctor` to see whether Windows Terminal was detected on this machine.",
    );
    return;
  }
  // Snapshot the resolved file, not the link. `restoreBackup` refuses to write *through* a
  // symlink (deliberately - that destination comes out of a file), so recording the link path
  // here produced a backup that could never be restored (#27).
  const target = resolveSettingsTarget(located);
  const backup = createBackup(target.path, "manual backup");
  console.log(successMessage(`Backup created: ${backup.id}`));
  console.log(chalk.gray(`Source: ${describeSettingsTarget(target)}`));
}

export function runBackupList(): void {
  const backups = listBackups();
  if (backups.length === 0) {
    console.log(
      emptyState(
        "No backups found.",
        "Run `nightshift backup create` to snapshot your current Windows Terminal settings.",
      ),
    );
    return;
  }
  console.log(
    renderTable(
      ["ID", "Created", "Reason", "Source"],
      backups.map((backup) => [
        chalk.cyan(backup.id),
        backup.createdAt,
        backup.reason,
        chalk.gray(backup.originalPath),
      ]),
    ),
  );
}

export function runRestore(backupId: string): void {
  // Adds the next step and rethrows rather than printing: the top-level handler in
  // src/cli/errors.ts stays the only place that renders a failure and sets the exit code
  // (A-11). An unknown id, a missing snapshot, and a traversal attempt (UnsafePathError) all
  // have the same remedy, so one hint covers them.
  let metadata;
  try {
    metadata = restoreBackup(backupId);
  } catch (error) {
    throw new NightshiftError(
      (error as Error).message,
      EXIT_FAILURE,
      "Run `nightshift backup list` to see available backup ids.",
    );
  }
  console.log(successMessage(`Restored ${metadata.originalPath} from backup ${backupId}.`));
}
