import chalk from "chalk";

/**
 * Honours `NO_COLOR` and `--no-color` explicitly instead of relying on chalk's own detection.
 *
 * Why this is not left to chalk: chalk/supports-color lets `FORCE_COLOR` *override* `NO_COLOR`,
 * so `FORCE_COLOR=3 NO_COLOR=1` still emits ANSI. That also makes the behaviour untestable
 * without a real TTY, because the only way to get chalk to colorize a piped stream is
 * `FORCE_COLOR` - the very variable that defeats `NO_COLOR`. Setting `chalk.level = 0` here is
 * final and beats both, which makes "no ANSI under NO_COLOR" a mechanically provable property.
 *
 * Per the no-color.org spec, any non-empty `NO_COLOR` value disables color.
 *
 * Runs as an import side effect so it applies before any command renders. `src/cli/ui/` is the
 * only place allowed to touch rendering libraries directly, so this is the right home for it.
 */
export function colorDisabledByRequest(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv,
): boolean {
  const noColorEnv = env.NO_COLOR;
  if (noColorEnv !== undefined && noColorEnv !== "") return true;
  return argv.includes("--no-color");
}

/**
 * `--no-color` is registered as a real Commander option on the root program in `src/index.ts`,
 * so it is visible in `--help` and accepted in any position. It is still *read* here from argv
 * rather than from `program.opts()`, because `chalk.level` must be set before any command
 * renders, and Commander only hands over parsed options once an action is already running.
 *
 * An earlier revision spliced the flag out of `process.argv` so Commander would never see an
 * unregistered option. That is gone: mutating shared argv depended on every command module
 * being imported at `src/index.ts`'s module scope, which the planned lazy-import work (G18)
 * would have quietly broken.
 */
export function applyColorMode(): void {
  if (colorDisabledByRequest()) {
    chalk.level = 0;
  }
}

applyColorMode();
