import chalk from "chalk";
import {
  detectInstalledFonts,
  findInstalledFont,
  type FontLookup,
  type FontScan,
} from "../../core/fonts/detect.js";
import { renderTable } from "../ui/table.js";
import { failWith, emptyState, successMessage } from "../ui/feedback.js";

/**
 * Printer for the read-only half of font support. Detection lives in `core/fonts/detect.ts`;
 * nothing here decides anything.
 *
 * Font *installation* is not implemented - it writes outside NIGHTSHIFT's own config directory,
 * so it needs the same shown-proposal-and-approval flow as `setup`. Both failure hints below say
 * so rather than leaving the user to guess why `font check` offers no fix.
 */

const NERD_FONT_FOOTNOTE =
  'Nerd Font is a name-based heuristic (family name contains "Nerd Font" or an "NF" token). ' +
  "Glyph coverage was not inspected.";

const INSTALL_HINT =
  "NIGHTSHIFT does not install fonts yet; install it with Windows' own font installer, then re-run this command.";

/** The two non-`supported` detection outcomes, reported rather than silently shown as empty. */
function reportUnavailable(result: FontScan | FontLookup): boolean {
  if (result.support === "unsupported") {
    failWith(
      `Font detection is not implemented on ${result.platform}.`,
      "Windows is the only platform whose font directories NIGHTSHIFT can read; run `nightshift doctor` to see what was detected.",
    );
    return true;
  }
  if (result.support === "unknown") {
    failWith(
      "No Windows font directory could be located.",
      "NIGHTSHIFT reads %LOCALAPPDATA%\\Microsoft\\Windows\\Fonts and %WINDIR%\\Fonts; check that those environment variables are set.",
    );
    return true;
  }
  return false;
}

export function runFontList(): void {
  const scan = detectInstalledFonts();
  if (reportUnavailable(scan)) return;

  if (scan.families.length === 0) {
    console.log(
      emptyState(
        "No font families were readable in this system's font directories.",
        `Searched: ${scan.directories.join(", ")}`,
      ),
    );
    return;
  }

  const nerdFonts = scan.families.filter((entry) => entry.nerdFont).length;
  console.log(
    chalk.bold(
      `${scan.families.length} font families installed (${nerdFonts} look like Nerd Fonts)`,
    ),
  );
  console.log(
    renderTable(
      ["Family", "Installed for", "Nerd Font?"],
      scan.families.map((entry) => [
        entry.family,
        entry.source === "user" ? "this user" : "all users",
        entry.nerdFont ? chalk.green("likely") : chalk.gray("no"),
      ]),
    ),
  );
  console.log(chalk.gray(`Searched: ${scan.directories.join(", ")}`));
  console.log(chalk.gray(NERD_FONT_FOOTNOTE));
}

export function runFontCheck(family: string): void {
  const lookup = findInstalledFont(family);
  if (reportUnavailable(lookup)) return;

  if (!lookup.match) {
    failWith(
      `Font family "${family}" is not installed on this system.`,
      `Run \`nightshift font list\` to see the installed families. ${INSTALL_HINT}`,
    );
    return;
  }

  const scope = lookup.match.source === "user" ? "for this user" : "for all users";
  console.log(successMessage(`"${lookup.match.family}" is installed ${scope}.`));
  if (lookup.match.nerdFont) {
    console.log(chalk.gray(`  ${NERD_FONT_FOOTNOTE}`));
  }
}
