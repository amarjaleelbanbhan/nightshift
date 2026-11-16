import chalk from "chalk";
import {
  buildShellIntegrationPlan,
  executeShellIntegration,
  findManagedBlock,
  BLOCK_START,
  BLOCK_END,
  type ShellIntegrationPlan,
} from "../../core/shell/integrate.js";
import { describeShellProfile } from "../../core/shell/detect.js";
import { renderTable } from "../ui/table.js";
import { emptyState, failWith, successMessage, warnMessage } from "../ui/feedback.js";

/**
 * Printer for shell integration. Detection lives in `core/shell/detect.ts` and the managed-block
 * engine in `core/shell/integrate.ts`; nothing here decides anything.
 *
 * `shell init` and `shell remove` edit a file the user's shell *executes* on every start, which
 * is the highest blast radius in this product, so they carry the same structure as `setup` and
 * `font install` and add no second approval flow: the plan is built and rendered by functions
 * that perform no writes, `executeShellIntegration` runs only after approval, and without a TTY
 * the proposal is printed and nothing is written at all.
 *
 * One thing is different from `setup` and `font install`, and deliberately so: the proposal
 * contains the **exact diff**, line by line, of what would change - because the consent being
 * asked for here is consent to specific lines of shell source, and "a block will be added" is
 * not that.
 */

/** What NIGHTSHIFT does not do here, stated before approval rather than discovered after. */
const STARSHIP_LIMITATION =
  "NIGHTSHIFT does not generate or edit starship.toml. If Starship is installed, the block " +
  "below initialises it; your prompt's appearance still comes from your own starship.toml, " +
  "which NIGHTSHIFT neither writes nor reads.";

const THEME_STALENESS_LIMITATION =
  "The block records the active theme id at the time it is written. `theme apply` does not " +
  "update it - re-run `nightshift shell init` after switching themes.";

export function runShellStatus(): void {
  const plan = buildShellIntegrationPlan("init");
  const rows: string[][] = [
    ["Platform", plan.platform],
    ["Shell", plan.shellLabel ?? chalk.yellow("not identified")],
    ["Detected by", plan.evidence || "-"],
  ];

  if (plan.target) {
    rows.push(
      ["Profile", describeShellProfile(plan.target)],
      [
        "Profile exists",
        plan.target.exists ? chalk.green("yes") : chalk.yellow("no (would be created)"),
      ],
      [
        "Managed block",
        findManagedBlock(plan.originalText).kind === "found"
          ? chalk.green("present")
          : chalk.gray("absent"),
      ],
    );
  }

  rows.push(
    ["Starship binary", plan.starship.binary ?? chalk.gray("not found on PATH")],
    [
      "starship.toml",
      plan.starship.configExists
        ? (plan.starship.configPath ?? "-")
        : chalk.gray(
            `not found${plan.starship.configPath ? ` at ${plan.starship.configPath}` : ""}`,
          ),
    ],
    ["Active theme", plan.themeId ?? chalk.gray("none")],
  );

  console.log(chalk.bold("Shell integration"));
  console.log(renderTable(["Check", "Value"], rows));

  if (plan.otherShell) {
    console.log(
      warnMessage(
        `This environment advertises SHELL=${plan.otherShell}, which NIGHTSHIFT does not write.`,
        "Only PowerShell profiles are supported; bash and zsh startup files are not implemented.",
      ),
    );
  }
  if (plan.problem) {
    // `status` reports rather than fails - it is one of the commands a user runs *because*
    // something is wrong.
    console.log(warnMessage(plan.problem));
  }
  console.log(chalk.gray(STARSHIP_LIMITATION));
  console.log(chalk.gray(THEME_STALENESS_LIMITATION));
}

/**
 * The exact diff, which is the thing being approved.
 *
 * Every changed line is shown with a `+`/`-` marker and the unchanged lines around the block are
 * shown without one, so what is *not* changing is as visible as what is. This is not a general
 * diff algorithm and does not need to be: the change is always one contiguous block region,
 * computed as verbatim slices of the file either side of it, so listing the removed and added
 * lines of that region *is* the complete diff.
 */
function renderDiff(plan: ShellIntegrationPlan): string[] {
  const lines: string[] = [];
  for (const line of plan.contextBefore) lines.push(chalk.gray(`      ${line}`));
  for (const line of plan.removedLines) lines.push(chalk.red(`    - ${line}`));
  for (const line of plan.addedLines) lines.push(chalk.green(`    + ${line}`));
  for (const line of plan.contextAfter) lines.push(chalk.gray(`      ${line}`));
  if (lines.length === 0) lines.push(chalk.gray("      (no change)"));
  return lines;
}

/** Renders the plan as the numbered list of writes it authorises, with the diff. Writes nothing. */
export function renderShellProposal(plan: ShellIntegrationPlan): string {
  const target = plan.target;
  if (!target) return chalk.bold("Shell integration proposal");

  const removing = plan.action === "remove";
  const lines: string[] = [
    chalk.bold(`Shell integration proposal (${plan.shellLabel})`),
    "",
    `  ${chalk.cyan("1.")} Back up your shell profile first`,
    `     ${describeShellProfile(target)}`,
  ];

  if (!target.exists) {
    lines.push(
      `     ${chalk.gray("The file does not exist yet, so there is nothing to snapshot; it would be created below.")}`,
    );
  }
  if (!target.dirExists) {
    lines.push(`     ${chalk.yellow("The directory would be created:")} ${target.dir}`);
  }

  lines.push(
    `  ${chalk.cyan("2.")} ${
      removing
        ? "Delete NIGHTSHIFT's managed block from that file"
        : plan.action === "replace"
          ? "Replace the contents of NIGHTSHIFT's existing managed block"
          : `${target.exists ? "Append" : "Write"} NIGHTSHIFT's managed block to that file`
    }`,
    `     ${chalk.gray(`Only the lines between ${BLOCK_START} and ${BLOCK_END} are touched.`)}`,
    "",
    `  ${chalk.bold(target.path)}`,
    ...renderDiff(plan),
    "",
  );

  if (!removing) {
    lines.push(
      `  ${chalk.cyan("3.")} ${chalk.yellow("Generate a Starship configuration")} - ${chalk.bold("not performed")}`,
      `     ${chalk.gray(STARSHIP_LIMITATION)}`,
      `     ${chalk.gray(
        plan.starship.binary
          ? `starship found at ${plan.starship.binary}, so the block initialises it.`
          : "starship was not found on PATH, so the block contains no Starship line at all.",
      )}`,
      `     ${chalk.gray(THEME_STALENESS_LIMITATION)}`,
    );
  }

  lines.push(
    "",
    chalk.gray(
      "Nothing outside the lines marked + / - changes: the rest of the file is written back byte for byte.",
    ),
  );
  return lines.join("\n");
}

/** The shared proposal-then-approve path for both writing commands. */
async function runShellEdit(
  intent: "init" | "remove",
  options: { yes?: boolean | undefined },
): Promise<void> {
  const plan = buildShellIntegrationPlan(intent);

  if (plan.problem) {
    failWith(
      plan.problem,
      plan.support === "unsupported"
        ? "Windows and PowerShell are the only shell NIGHTSHIFT writes a profile for; run `nightshift shell status` to see what was detected."
        : "Run `nightshift shell status` to see what was detected, and fix the file by hand if it names one.",
    );
    return;
  }

  if (plan.unchanged) {
    console.log(
      emptyState(
        intent === "remove"
          ? "Nothing to remove - your shell profile has no NIGHTSHIFT managed block."
          : "Nothing to change - your shell profile's managed block is already exactly this.",
        "`nightshift shell status` shows what was detected.",
      ),
    );
    return;
  }

  console.log(renderShellProposal(plan));
  console.log();

  if (!options.yes) {
    // The same TTY guard `setup` and `font install` carry, for both of its reasons: a clack
    // prompt has nothing to read from in CI, a pipe, or redirected output and would hang
    // forever, and with no way to obtain consent this command must write nothing at all.
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.log(
        emptyState(
          "Nothing has been written - this is a non-interactive environment, so no approval could be given.",
          `Re-run as \`nightshift shell ${intent} --yes\` to accept the proposal above without a prompt.`,
        ),
      );
      return;
    }

    // Imported here, not at module scope, so `shell status` does not load @clack/prompts.
    const { promptConfirm } = await import("../ui/prompts.js");
    if (!(await promptConfirm(intent === "remove" ? "Remove this block?" : "Apply this edit?"))) {
      console.log(emptyState("Cancelled. Nothing was written."));
      return;
    }
  }

  const result = executeShellIntegration(plan);
  if (!result.ok) {
    failWith(
      result.message,
      "Your profile was restored from the backup taken in step 1. `nightshift backup list` shows it.",
    );
    return;
  }

  console.log(successMessage(`${result.message} Backup id: ${result.backupId}.`));
  console.log();
  console.log(
    intent === "remove"
      ? chalk.gray("Open a new shell for the change to take effect.")
      : chalk.gray(
          "Open a new shell for the change to take effect, then `nightshift shell remove` undoes it.",
        ),
  );
}

export async function runShellInit(options: { yes?: boolean | undefined } = {}): Promise<void> {
  await runShellEdit("init", options);
}

export async function runShellRemove(options: { yes?: boolean | undefined } = {}): Promise<void> {
  await runShellEdit("remove", options);
}
