import chalk from "chalk";
import { isInitialized, initializeConfig } from "../../core/config/store.js";
import { getNightshiftRoot } from "../../core/config/paths.js";

export function runInit(): void {
  if (isInitialized()) {
    console.log(chalk.yellow("NIGHTSHIFT is already initialized."));
    console.log(chalk.gray(`Config: ${getNightshiftRoot()}`));
    return;
  }

  const config = initializeConfig();
  console.log(chalk.green("NIGHTSHIFT initialized."));
  console.log(chalk.gray(`Config directory: ${getNightshiftRoot()}`));
  console.log(chalk.gray(`Created at: ${config.initializedAt}`));
  console.log();
  console.log(`Run ${chalk.cyan("nightshift theme list")} to see available themes.`);
}
