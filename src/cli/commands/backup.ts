import chalk from "chalk";
import { createBackup, listBackups, restoreBackup } from "../../backup/manager.js";
import { detectCapabilities } from "../../core/capabilities/detect.js";
import { renderTable } from "../ui/table.js";

export function runBackupCreate(): void {
  const caps = detectCapabilities();
  const settingsPath = caps.windowsTerminal.settingsPath;
  if (!settingsPath) {
    console.error(chalk.red("No Windows Terminal settings.json detected to back up."));
    process.exitCode = 1;
    return;
  }
  const backup = createBackup(settingsPath, "manual backup");
  console.log(chalk.green(`Backup created: ${backup.id}`));
  console.log(chalk.gray(`Source: ${settingsPath}`));
}

export function runBackupList(): void {
  const backups = listBackups();
  if (backups.length === 0) {
    console.log(chalk.gray("No backups found."));
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
  try {
    const metadata = restoreBackup(backupId);
    console.log(chalk.green(`Restored ${metadata.originalPath} from backup ${backupId}.`));
  } catch (error) {
    console.error(chalk.red((error as Error).message));
    process.exitCode = 1;
  }
}
