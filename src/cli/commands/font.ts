import chalk from "chalk";
import {
  detectInstalledFonts,
  findInstalledFont,
  type FontLookup,
  type FontScan,
} from "../../core/fonts/detect.js";
import {
  buildFontInstallPlan,
  executeFontInstall,
  FONT_INSTALL_EXTENSIONS,
  type FontInstallPlan,
  type FontInstallResult,
} from "../../core/fonts/install.js";
import { renderTable } from "../ui/table.js";
import { failWith, emptyState, successMessage, warnMessage } from "../ui/feedback.js";

/**
 * Printer for font support. Detection lives in `core/fonts/detect.ts` and installation in
 * `core/fonts/install.ts`; nothing here decides anything.
 *
 * `font install` writes outside NIGHTSHIFT's own config directory, so it carries the same
 * shown-proposal-and-approval structure as `setup`: the proposal is built and rendered by
 * functions that perform no writes, and `executeFontInstall` runs only after approval - so the
 * non-interactive path is structurally incapable of touching the font directory rather than
 * merely choosing not to.
 */

const NERD_FONT_FOOTNOTE =
  'Nerd Font is a name-based heuristic (family name contains "Nerd Font" or an "NF" token). ' +
  "Glyph coverage was not inspected.";

const INSTALL_HINT =
  "If you have the font file locally, `nightshift font install <path>` copies it into your user font directory.";

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

/**
 * The one thing `font install` cannot do, stated in the proposal *before* approval rather than
 * discovered afterwards. See the module comment in `core/fonts/install.ts`.
 */
const REGISTRATION_LIMITATION =
  "NIGHTSHIFT copies the file but does NOT create the registry value Windows uses to " +
  "enumerate fonts, so Windows Terminal and other applications may not offer the family " +
  "until you finish the install yourself (the exact command is printed afterwards).";

/** The registry value name Windows uses for a font file, which depends on its container. */
function registryValueName(family: string, destination: string): string {
  return `${family} (${destination.toLowerCase().endsWith(".otf") ? "OpenType" : "TrueType"})`;
}

/** Renders the plan as the numbered list of writes it authorises. Writes nothing. */
export function renderFontInstallProposal(plan: FontInstallPlan): string {
  const lines: string[] = [chalk.bold("Font install proposal"), ""];
  const count = plan.files.length;

  lines.push(
    `  ${chalk.cyan("1.")} Copy ${count} font file${count === 1 ? "" : "s"} into your per-user font directory`,
    `     ${plan.fontDir}`,
  );
  for (const file of plan.files) {
    lines.push(
      `       ${file.replaces ? chalk.yellow("~ replace") : chalk.green("+ add")}  ${file.destination}`,
      `         ${chalk.gray(`from ${file.source} - declares ${file.families.join(", ")}`)}`,
    );
  }

  lines.push(
    `  ${chalk.cyan("2.")} ${chalk.yellow("Register the font with Windows")} - ${chalk.bold("not performed")}`,
    `     ${chalk.gray(REGISTRATION_LIMITATION)}`,
    "",
    chalk.gray("Nothing outside the font directory above is modified."),
  );
  return lines.join("\n");
}

/** Prints what really happened, including the half that did not. */
function reportFontInstall(plan: FontInstallPlan, result: FontInstallResult): void {
  for (const failure of result.failed) {
    console.log(warnMessage(`Could not copy "${failure.source}": ${failure.message}`));
  }

  if (result.copied.length > 0) {
    console.log(
      successMessage(
        `Copied ${result.copied.length} font file${result.copied.length === 1 ? "" : "s"} into ${plan.fontDir}`,
      ),
    );
  }

  // The verification: detection re-run, not an assumption that the copy was enough.
  const missing = result.verified.filter((entry) => !entry.found);
  for (const entry of result.verified.filter((entry) => entry.found)) {
    console.log(successMessage(`"${entry.family}" is now found by NIGHTSHIFT's font detection.`));
  }

  if (result.failed.length > 0 || missing.length > 0) {
    // Reported as a failure, not as a success with a footnote: a family the detector cannot
    // find afterwards is not installed, whatever the copy said.
    failWith(
      `The install did not complete - ${[
        ...result.failed.map((failure) => `"${failure.source}" could not be copied`),
        ...missing.map(
          (entry) => `"${entry.family}" is still not found by NIGHTSHIFT's font detection`,
        ),
      ].join("; ")}.`,
      "Run `nightshift font list` to see what the font directory really contains, then re-run with a readable font file.",
    );
    return;
  }

  console.log();
  console.log(
    warnMessage(
      "The font is not registered with Windows. NIGHTSHIFT can see it, but applications that read the font registry may not.",
      "Finish the install by running the command(s) below in PowerShell, or open the font directory above and use Windows' own Install.",
    ),
  );
  for (const file of result.copied) {
    for (const family of file.families) {
      console.log(
        chalk.gray(
          `  reg add "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts" /v "${registryValueName(family, file.destination)}" /t REG_SZ /d "${file.destination}" /f`,
        ),
      );
    }
  }
}

export async function runFontInstall(
  sourcePath: string,
  options: { yes?: boolean | undefined } = {},
): Promise<void> {
  const plan = buildFontInstallPlan(sourcePath);
  if (plan.problem) {
    failWith(
      plan.problem,
      plan.support === "unsupported"
        ? "Windows is the only platform with a font directory NIGHTSHIFT can write to; run `nightshift doctor` to see what was detected."
        : plan.support === "unknown"
          ? "NIGHTSHIFT installs into %LOCALAPPDATA%\\Microsoft\\Windows\\Fonts; check that LOCALAPPDATA is set."
          : `Pass the path of a ${FONT_INSTALL_EXTENSIONS.join(", ")} file, or of a directory containing them.`,
    );
    return;
  }

  console.log(renderFontInstallProposal(plan));
  console.log();

  if (!options.yes) {
    // The same TTY guard `setup` carries, for both of its reasons: a clack prompt has nothing to
    // read from in CI, a pipe, or redirected output and would hang forever, and with no way to
    // obtain consent this command must write nothing at all.
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.log(
        emptyState(
          "Nothing has been written - this is a non-interactive environment, so no approval could be given.",
          "Re-run as `nightshift font install <path> --yes` to accept the proposal above without a prompt.",
        ),
      );
      return;
    }

    // Imported here, not at module scope, so `font list` and `font check` do not load
    // @clack/prompts - the same reason the registries are imported lazily in completion.ts.
    const { promptConfirm } = await import("../ui/prompts.js");
    if (!(await promptConfirm("Install these font files?"))) {
      console.log(emptyState("Install cancelled. Nothing was written."));
      return;
    }
  }

  reportFontInstall(plan, executeFontInstall(plan));
}
