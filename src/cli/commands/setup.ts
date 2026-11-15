import chalk from "chalk";
import { detectCapabilities } from "../../core/capabilities/detect.js";
import { isInitialized, initializeConfig } from "../../core/config/store.js";
import { getNightshiftRoot, getBackupsDir } from "../../core/config/paths.js";
import { getTheme } from "../../core/themes/registry.js";
import { applyThemeToWindowsTerminal } from "../../core/themes/apply.js";
import { promptConfirm } from "../ui/prompts.js";
import { successMessage, warnMessage, emptyState, failWith } from "../ui/feedback.js";

/**
 * Guided first-run configuration.
 *
 * `setup` is the only command that writes *outside* NIGHTSHIFT's own config directory without
 * being asked for that specific write by name, so `ROADMAP_STATUS.md`'s rule applies in full:
 * show the exact proposal - every path, the theme, the backup - and get explicit approval
 * before touching anything. The proposal is built and printed by functions that perform no
 * writes at all, so the non-interactive path is *structurally* incapable of modifying the
 * machine rather than merely choosing not to.
 */

/**
 * The theme `setup` proposes when nothing else is specified. Ghost Protocol is the safe
 * default: it is a built-in (so it cannot be missing), and all six of its checked colors clear
 * WCAG AA 4.5:1 against its own background.
 */
export const DEFAULT_SETUP_THEME_ID = "ghost-protocol";

export interface SetupProposal {
  configRoot: string;
  configExists: boolean;
  backupsDir: string;
  themeId: string;
  themeName: string;
  /** Windows Terminal's settings.json, or null when it was not found. */
  settingsPath: string | null;
  platform: NodeJS.Platform;
}

/** Detects the environment and describes what `setup` *would* do. Writes nothing. */
export function buildSetupProposal(themeId: string = DEFAULT_SETUP_THEME_ID): SetupProposal {
  const caps = detectCapabilities();
  const theme = getTheme(themeId);
  return {
    configRoot: getNightshiftRoot(),
    configExists: isInitialized(),
    backupsDir: getBackupsDir(),
    themeId,
    themeName: theme?.name ?? themeId,
    settingsPath: caps.windowsTerminal.settingsPath,
    platform: caps.platform,
  };
}

/** Renders the proposal as the numbered list of writes it authorises. Writes nothing. */
export function renderSetupProposal(proposal: SetupProposal): string {
  const lines: string[] = [chalk.bold("Setup proposal"), ""];

  lines.push(
    `  ${chalk.cyan("1.")} ${proposal.configExists ? "Reuse" : "Create"} NIGHTSHIFT's configuration directory`,
    `     ${proposal.configRoot}${proposal.configExists ? chalk.gray("  (already exists)") : chalk.gray("  (will be created)")}`,
  );

  if (proposal.settingsPath) {
    lines.push(
      `  ${chalk.cyan("2.")} Back up Windows Terminal's settings.json first`,
      `     ${proposal.settingsPath}`,
      `     ${chalk.gray(`-> snapshot in ${proposal.backupsDir}`)}`,
      `  ${chalk.cyan("3.")} Apply the theme ${chalk.bold(proposal.themeName)} (${proposal.themeId}) to that settings.json`,
      `     ${chalk.gray("Unrelated keys are preserved; the write is verified and rolled back on failure.")}`,
    );
  } else {
    lines.push(
      `  ${chalk.cyan("2.")} ${chalk.yellow("Skip theme application")} - Windows Terminal settings.json was not found`,
      `     ${chalk.gray(`platform: ${proposal.platform}; no file outside the directory above would be modified.`)}`,
    );
  }

  lines.push("", chalk.gray("Nothing outside the paths listed above is modified."));
  return lines.join("\n");
}

/**
 * Performs the approved proposal. Reuses `initializeConfig()` and the apply engine in
 * `core/themes/apply.ts` - there is no second configuration or application path here.
 */
export function executeSetup(proposal: SetupProposal): void {
  if (!proposal.configExists) initializeConfig();
  console.log(
    successMessage(
      proposal.configExists
        ? `Configuration directory in place: ${proposal.configRoot}`
        : `Created configuration directory: ${proposal.configRoot}`,
    ),
  );

  if (!proposal.settingsPath) {
    // Not a failure: step 2 of the proposal the user approved said this would be skipped, so
    // exiting non-zero would contradict what was agreed to. `doctor` is where "your terminal
    // is missing" belongs.
    console.log(
      warnMessage(
        `Skipped applying "${proposal.themeName}" - Windows Terminal settings.json was not found.`,
        "Install Windows Terminal, then run `nightshift theme apply " +
          proposal.themeId +
          "`. `nightshift doctor` re-checks the environment.",
      ),
    );
    return;
  }

  const result = applyThemeToWindowsTerminal(proposal.themeId);
  if (!result.ok) {
    failWith(
      result.message,
      "Run `nightshift doctor` to check your environment, then re-run `nightshift setup`.",
    );
    return;
  }
  console.log(successMessage(result.message));
  console.log();
  console.log(
    `Run ${chalk.cyan("nightshift status")} to see the result, or ${chalk.cyan("nightshift theme list")} to pick a different theme.`,
  );
}

export async function runSetup(options: { yes?: boolean | undefined } = {}): Promise<void> {
  const proposal = buildSetupProposal();
  console.log(renderSetupProposal(proposal));
  console.log();

  if (!options.yes) {
    // The same TTY guard every interactive flow in this CLI carries: a clack prompt has nothing
    // to read from in CI, a pipe, or redirected output and hangs forever waiting for input that
    // never arrives (a real, previously-fixed bug - see runInteractiveHome). Here it doubles as
    // the safety property: with no way to obtain consent, setup writes nothing at all.
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.log(
        emptyState(
          "Nothing has been written - this is a non-interactive environment, so no approval could be given.",
          "Re-run as `nightshift setup --yes` to accept the proposal above without a prompt.",
        ),
      );
      return;
    }

    if (!(await promptConfirm("Apply this setup?"))) {
      console.log(emptyState("Setup cancelled. Nothing was written."));
      return;
    }
  }

  executeSetup(proposal);
}
