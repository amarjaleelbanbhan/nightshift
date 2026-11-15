import chalk from "chalk";
import "./color-mode.js";

/**
 * Error, empty-state, and confirmation text for one-shot commands.
 *
 * Deliberately plain lines, not `boxen` panels: the recorded two-border-language rule reserves
 * boxen for one-shot *command headers* (`panel.ts`) and clack's `note`/`box` for the interactive
 * flow. A failure message is not a header, and boxing every error would both mix border
 * languages on one screen and bury a one-line message in six lines of chrome. What these give
 * is a consistent *shape* - marker, message, and an actionable next step - which is what was
 * actually missing, rather than more decoration.
 *
 * `error` and `empty` return strings; the caller decides stdout vs stderr and the exit code.
 */

/** A failure message with an optional concrete next step. */
export function errorMessage(message: string, hint?: string): string {
  const head = `${chalk.red("✗")} ${message}`;
  return hint ? `${head}\n  ${chalk.gray(`→ ${hint}`)}` : head;
}

/** An empty-list message that says how to populate the list. */
export function emptyState(message: string, hint?: string): string {
  const head = chalk.gray(message);
  return hint ? `${head}\n  ${chalk.gray(`→ ${hint}`)}` : head;
}

/** A success confirmation. */
export function successMessage(message: string): string {
  return `${chalk.green("✓")} ${message}`;
}

/** A non-fatal warning. */
export function warnMessage(message: string, hint?: string): string {
  const head = `${chalk.yellow("!")} ${message}`;
  return hint ? `${head}\n  ${chalk.gray(`→ ${hint}`)}` : head;
}

/**
 * Prints an error to stderr and sets a non-zero exit code, which is the shape every failing
 * one-shot command needs. Does not throw or call `process.exit`, so the top-level handler and
 * the exit-code contract stay in charge of the process lifecycle.
 */
export function failWith(message: string, hint?: string): void {
  console.error(errorMessage(message, hint));
  process.exitCode = 1;
}
