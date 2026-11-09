import chalk from "chalk";
import type { Theme } from "../core/themes/schema.js";

const LOGO = [
  " _  _ _ ____ _  _ ___ ____ _  _ _ ____ ___ ",
  " |\\ | | |__| |__|  |  [__] |__| | |___  |  ",
];

/**
 * Renders the static startup banner. The ASCII Art Studio (custom/imported
 * banners) is a planned feature, not yet built — this is intentionally a
 * single fixed logo rather than a font-rendering engine.
 */
export function renderBanner(activeTheme?: Theme): string {
  const accent = activeTheme?.colors.primary ?? "#65E58B";
  const color = chalk.hex(accent);
  return [
    "",
    ...LOGO.map((line) => color.bold(line)),
    chalk.gray("Your terminal. Your identity."),
    "",
  ].join("\n");
}
