#!/usr/bin/env node
import { Command } from "commander";
import { version } from "./cli/version.js";
import { runInit } from "./cli/commands/init.js";
import { runStatus } from "./cli/commands/status.js";
import {
  runThemeList,
  runThemePreview,
  runThemeApply,
  runThemeValidate,
  runThemeCreate,
  runThemeRemove,
} from "./cli/commands/theme.js";
import { runSetup } from "./cli/commands/setup.js";
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
import { reportFatal } from "./cli/errors.js";

const program = new Command();

program
  .name("nightshift")
  .description("Your terminal. Your identity. — an open-source terminal customization toolkit.")
  .version(version)
  // Registered here so it appears in `--help`. The flag is *read* in src/cli/ui/color-mode.ts,
  // which scans argv at import time, because chalk's level has to be set before any command
  // renders. Commander 13 resolves a root option appearing after a subcommand against the
  // parent (verified: `theme list --no-color` parses), so one registration covers every
  // position - which is what let color-mode.ts stop splicing the flag out of process.argv.
  .option("--no-color", "disable ANSI color output (same as NO_COLOR=1)");

program.command("init").description("Create NIGHTSHIFT's user-level configuration").action(runInit);

program
  .command("status")
  .description("Show NIGHTSHIFT's current status and detected capabilities")
  .action(runStatus);

program
  .command("setup")
  .description("Guided first-run configuration: show a proposal, then apply it on approval")
  .option("--yes", "accept the proposal without a prompt (required in non-interactive shells)")
  .action((options: { yes?: boolean }) => runSetup(options));

const theme = program.command("theme").description("Manage terminal themes");
theme.command("list").description("List available themes").action(runThemeList);
theme
  .command("preview <id>")
  .description("Preview a theme's colors in the terminal")
  .action(runThemePreview);
theme.command("apply <id>").description("Apply a theme to Windows Terminal").action(runThemeApply);
theme
  .command("validate <file>")
  .description("Validate a theme JSON file and report every issue it has")
  .action(runThemeValidate);
theme
  .command("create")
  .description("Create a user theme by cloning an existing one")
  .requiredOption("--id <id>", "id for the new theme (lowercase, digits, hyphens)")
  .requiredOption("--name <name>", "display name for the new theme")
  .option("--from <themeId>", "theme to clone as the starting point", "ghost-protocol")
  .option("--description <text>", "optional description shown in `theme list`")
  .option("--overwrite", "replace an existing user theme with the same id")
  .action(
    (options: {
      id: string;
      name: string;
      from?: string;
      description?: string;
      overwrite?: boolean;
    }) => runThemeCreate(options),
  );
theme.command("remove <id>").description("Remove a user-created theme").action(runThemeRemove);

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

// Bare `nightshift` opens the interactive menu. Because the program then has an action
// handler and declares no arguments of its own, Commander would reject a top-level typo as
// "too many arguments" rather than "unknown command"; excess arguments are allowed through
// here so the stray positional can be reported for what it is. Exit code stays 1, matching
// Commander's own usage errors.
program.allowExcessArguments(true).action(async (_options, command: Command) => {
  const [unknown] = command.args;
  if (unknown !== undefined) {
    program.error(`error: unknown command '${unknown}'`);
  }
  await runInteractiveHome();
});

try {
  await program.parseAsync(process.argv);
} catch (error) {
  reportFatal(error);
}
