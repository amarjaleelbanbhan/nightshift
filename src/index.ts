#!/usr/bin/env node
import { Command } from "commander";
import { version } from "./cli/version.js";
import { runInit } from "./cli/commands/init.js";
import { runStatus } from "./cli/commands/status.js";
import { runThemeList, runThemePreview, runThemeApply } from "./cli/commands/theme.js";
import {
  runProfileList,
  runProfileShow,
  runProfileApply,
  runProfileImport,
  runProfileExport,
  runProfileRemove,
} from "./cli/commands/profile.js";
import { runDoctor } from "./cli/commands/doctor.js";
import { runBackupCreate, runBackupList, runRestore } from "./cli/commands/backup.js";
import { runInteractiveHome } from "./cli/interactive/home.js";

const program = new Command();

program
  .name("nightshift")
  .description("Your terminal. Your identity. — an open-source terminal customization toolkit.")
  .version(version);

program
  .command("init")
  .description("Create NIGHTSHIFT's user-level configuration")
  .action(runInit);

program
  .command("status")
  .description("Show NIGHTSHIFT's current status and detected capabilities")
  .action(runStatus);

const theme = program.command("theme").description("Manage terminal themes");
theme.command("list").description("List available themes").action(runThemeList);
theme
  .command("preview <id>")
  .description("Preview a theme's colors in the terminal")
  .action(runThemePreview);
theme
  .command("apply <id>")
  .description("Apply a theme to Windows Terminal")
  .action(runThemeApply);

const profile = program.command("profile").description("Manage profiles");
profile.command("list").description("List available profiles").action(runProfileList);
profile.command("show <id>").description("Show details for a profile").action(runProfileShow);
profile
  .command("apply <id>")
  .description("Apply a profile's theme to Windows Terminal")
  .action(runProfileApply);
profile
  .command("import <file>")
  .description("Import a profile JSON file into NIGHTSHIFT's user profile directory")
  .option("--overwrite", "replace an existing user profile with the same id")
  .action((file, options: { overwrite?: boolean }) => runProfileImport(file, options));
profile
  .command("export <id>")
  .description("Export a profile to a standalone JSON file")
  .option("--output <path>", "destination file path")
  .option("--overwrite", "replace an existing file at the destination")
  .action((id, options: { output?: string; overwrite?: boolean }) => runProfileExport(id, options));
profile
  .command("remove <id>")
  .description("Remove a user-imported profile")
  .action(runProfileRemove);

program
  .command("doctor")
  .description("Diagnose the environment and NIGHTSHIFT's configuration")
  .action(runDoctor);

const backup = program.command("backup").description("Back up terminal configuration");
backup
  .command("create")
  .description("Back up the current Windows Terminal settings.json")
  .action(runBackupCreate);
backup.command("list").description("List existing backups").action(runBackupList);

program
  .command("restore <backupId>")
  .description("Restore a previous backup by id")
  .action(runRestore);

program.action(async () => {
  await runInteractiveHome();
});

await program.parseAsync(process.argv);
