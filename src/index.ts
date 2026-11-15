#!/usr/bin/env node
import { Command } from "commander";
import { version } from "./cli/version.js";
import { reportFatal } from "./cli/errors.js";

/**
 * Command *registration* below is eager; command *modules* are loaded lazily, inside each
 * action handler.
 *
 * Why: every command is a one-shot `node` invocation and there is no daemon, so module-graph
 * size is the felt performance of the product. Importing every command module here made
 * `nightshift --version` load zod, boxen, cli-table3 and @clack/prompts - 663 ms median for a
 * command that prints one string. Loading them per-action brought that to 124 ms, and took
 * 107-180 ms off every real command too, since none of them pay for the others any more
 * (G18; numbers and method in docs/development/PERFORMANCE_REPORT.md).
 *
 * Two constraints this must not break, both easy to break silently:
 *
 * - **`--help` stays complete.** Laziness applies only to action handlers. Every command,
 *   subcommand, argument, option and description is still declared here at module scope, so
 *   Commander's help generation sees exactly what it saw before - verified byte-identical for
 *   the root and every subcommand. `tests/integration/cli.test.ts` enumerates each registration
 *   and option against the built binary, because a registration that slips into a lazy module
 *   vanishes from help and from dispatch with no error anywhere.
 * - **Colour configuration still happens before any output.** `src/cli/ui/color-mode.ts` sets
 *   `chalk.level = 0` as an import side effect. ESM resolves a module's whole import graph
 *   before executing its body, so by the time a lazily imported `runX()` runs, color-mode has
 *   already run; and nothing here prints before the dynamic `import()`. This is why
 *   color-mode.ts no longer needs to splice `--no-color` out of `process.argv`.
 */
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

const initModule = () => import("./cli/commands/init.js");
const statusModule = () => import("./cli/commands/status.js");
const setupModule = () => import("./cli/commands/setup.js");
const themeModule = () => import("./cli/commands/theme.js");
const profileModule = () => import("./cli/commands/profile.js");
const doctorModule = () => import("./cli/commands/doctor.js");
const backupModule = () => import("./cli/commands/backup.js");
const fontModule = () => import("./cli/commands/font.js");

program
  .command("init")
  .description("Create NIGHTSHIFT's user-level configuration")
  .action(async () => (await initModule()).runInit());

program
  .command("status")
  .description("Show NIGHTSHIFT's current status and detected capabilities")
  .action(async () => (await statusModule()).runStatus());

program
  .command("setup")
  .description("Guided first-run configuration: show a proposal, then apply it on approval")
  .option("--yes", "accept the proposal without a prompt (required in non-interactive shells)")
  .action(async (options: { yes?: boolean }) => (await setupModule()).runSetup(options));

const theme = program.command("theme").description("Manage terminal themes");
theme
  .command("list")
  .description("List available themes")
  .action(async () => (await themeModule()).runThemeList());
theme
  .command("preview <id>")
  .description("Preview a theme's colors in the terminal")
  .action(async (id: string) => (await themeModule()).runThemePreview(id));
theme
  .command("apply <id>")
  .description("Apply a theme to Windows Terminal")
  .action(async (id: string) => (await themeModule()).runThemeApply(id));
theme
  .command("validate <file>")
  .description("Validate a theme JSON file and report every issue it has")
  .action(async (file: string) => (await themeModule()).runThemeValidate(file));
theme
  .command("create")
  .description("Create a user theme by cloning an existing one")
  .requiredOption("--id <id>", "id for the new theme (lowercase, digits, hyphens)")
  .requiredOption("--name <name>", "display name for the new theme")
  .option("--from <themeId>", "theme to clone as the starting point", "ghost-protocol")
  .option("--description <text>", "optional description shown in `theme list`")
  .option("--overwrite", "replace an existing user theme with the same id")
  .action(
    async (options: {
      id: string;
      name: string;
      from?: string;
      description?: string;
      overwrite?: boolean;
    }) => (await themeModule()).runThemeCreate(options),
  );
theme
  .command("remove <id>")
  .description("Remove a user-created theme")
  .action(async (id: string) => (await themeModule()).runThemeRemove(id));

const profile = program.command("profile").description("Manage profiles");
profile
  .command("list")
  .description("List available profiles")
  .action(async () => (await profileModule()).runProfileList());
profile
  .command("show <id>")
  .description("Show details for a profile")
  .action(async (id: string) => (await profileModule()).runProfileShow(id));
profile
  .command("apply <id>")
  .description("Apply a profile's theme to Windows Terminal")
  .action(async (id: string) => (await profileModule()).runProfileApply(id));
profile
  .command("import <file>")
  .description("Import a profile JSON file into NIGHTSHIFT's user profile directory")
  .option("--overwrite", "replace an existing user profile with the same id")
  .action(async (file: string, options: { overwrite?: boolean }) =>
    (await profileModule()).runProfileImport(file, options),
  );
profile
  .command("export <id>")
  .description("Export a profile to a standalone JSON file")
  .option("--output <path>", "destination file path")
  .option("--overwrite", "replace an existing file at the destination")
  .action(async (id: string, options: { output?: string; overwrite?: boolean }) =>
    (await profileModule()).runProfileExport(id, options),
  );
profile
  .command("remove <id>")
  .description("Remove a user-imported profile")
  .action(async (id: string) => (await profileModule()).runProfileRemove(id));

program
  .command("doctor")
  .description("Diagnose the environment and NIGHTSHIFT's configuration")
  .action(async () => (await doctorModule()).runDoctor());

const font = program.command("font").description("Inspect installed fonts");
font
  .command("list")
  .description("List font families installed on this system")
  .action(async () => (await fontModule()).runFontList());
font
  .command("check <family>")
  .description("Check whether a font family is installed (exit 1 if it is not)")
  .action(async (family: string) => (await fontModule()).runFontCheck(family));

const backup = program.command("backup").description("Back up terminal configuration");
backup
  .command("create")
  .description("Back up the current Windows Terminal settings.json")
  .action(async () => (await backupModule()).runBackupCreate());
backup
  .command("list")
  .description("List existing backups")
  .action(async () => (await backupModule()).runBackupList());

program
  .command("restore <backupId>")
  .description("Restore a previous backup by id")
  .action(async (backupId: string) => (await backupModule()).runRestore(backupId));

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
  await (await import("./cli/interactive/home.js")).runInteractiveHome();
});

try {
  await program.parseAsync(process.argv);
} catch (error) {
  reportFatal(error);
}
