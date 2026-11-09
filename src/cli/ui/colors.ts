import chalk, { type ChalkInstance } from "chalk";
import type { Theme } from "../../core/themes/schema.js";

export interface SemanticColors {
  primary: ChalkInstance;
  secondary: ChalkInstance;
  success: ChalkInstance;
  warning: ChalkInstance;
  error: ChalkInstance;
  muted: ChalkInstance;
  heading: ChalkInstance;
  primaryHex: string;
}

/** Used before a theme is active (fresh install, no `nightshift init` yet) - Ghost Protocol's palette as the brand default. */
const BRAND_DEFAULT = {
  primary: "#65E58B",
  secondary: "#87938B",
  success: "#65E58B",
  warning: "#E8B45C",
  error: "#F06464",
};

/**
 * Derives the CLI's semantic colors from the active theme when one is set, falling back to
 * the brand default. This is how the interactive UI stays theme-aware without hardcoding a
 * palette in every command.
 */
export function getSemanticColors(theme?: Theme): SemanticColors {
  const colors = theme?.colors ?? BRAND_DEFAULT;
  return {
    primary: chalk.hex(colors.primary),
    secondary: chalk.hex(colors.secondary),
    success: chalk.hex(colors.success),
    warning: chalk.hex(colors.warning),
    error: chalk.hex(colors.error),
    muted: chalk.gray,
    heading: chalk.bold,
    primaryHex: colors.primary,
  };
}
