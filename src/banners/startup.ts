import chalk from "chalk";
import type { Theme } from "../core/themes/schema.js";
import { getSemanticColors } from "../cli/ui/colors.js";
import { panel } from "../cli/ui/panel.js";
import { version } from "../cli/version.js";

/**
 * A compact themed identity panel for one-shot command output (`status`). Deliberately not a
 * blocky ASCII wordmark - "NIGHTSHIFT" is already a short, readable word; a letter-art banner
 * adds nothing but the exact generic-terminal-tool look this product is meant to avoid.
 */
export function renderStatusPanel(activeTheme?: Theme): string {
  const colors = getSemanticColors(activeTheme);
  const content = `${colors.primary.bold("NIGHTSHIFT")} ${chalk.gray(`v${version}`)}\n${chalk.gray("Your terminal. Your identity.")}`;
  return panel(content, { borderColorHex: colors.primaryHex });
}

/** A short title string for @clack/prompts' intro() - the interactive session uses clack's own bordered header instead of a separate banner, so the two don't visually compete. */
export function renderMasthead(): string {
  return `NIGHTSHIFT v${version} — Your terminal. Your identity.`;
}
