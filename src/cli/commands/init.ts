import chalk from "chalk";
import { isInitialized, initializeConfig } from "../../core/config/store.js";
import { getNightshiftRoot } from "../../core/config/paths.js";
// Imported for its glyph-bearing components *and* its side effect: `feedback.ts` pulls in
// `ui/color-mode.ts`, which is what applies NO_COLOR/--no-color. Before this, `init` was the
// one command that imported no UI module at all, so it ignored both.
import { successMessage, warnMessage } from "../ui/feedback.js";

export function runInit(): void {
  if (isInitialized()) {
    console.log(
      warnMessage(
        "NIGHTSHIFT is already initialized.",
        "Run `nightshift status` to see the current configuration.",
      ),
    );
    console.log(chalk.gray(`Config: ${getNightshiftRoot()}`));
    return;
  }

  const config = initializeConfig();
  console.log(successMessage("NIGHTSHIFT initialized."));
  console.log(chalk.gray(`Config directory: ${getNightshiftRoot()}`));
  console.log(chalk.gray(`Created at: ${config.initializedAt}`));
  console.log();
  console.log(`Run ${chalk.cyan("nightshift theme list")} to see available themes.`);
}
