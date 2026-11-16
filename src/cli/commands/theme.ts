import chalk from "chalk";
import { listThemes, getTheme } from "../../core/themes/registry.js";
import { tryReadConfig } from "../../core/config/store.js";
import { applyThemeToWindowsTerminal } from "../../core/themes/apply.js";
import {
  validateThemeFile,
  createTheme,
  removeTheme,
  editTheme,
  type ThemeIssue,
} from "../../core/themes/manager.js";
import type { Theme } from "../../core/themes/schema.js";
import { buildApplyPreview, printApplyPreview } from "./apply-preview.js";
import { renderTable } from "../ui/table.js";
import { failWith, successMessage, warnMessage, emptyState } from "../ui/feedback.js";
import { auditThemeContrast, WCAG_AA_BODY, WCAG_AA_LARGE } from "../../core/themes/contrast.js";
import { reportConfigCorrupt } from "../errors.js";

export function runThemeList(): void {
  const entries = listThemes();
  // A corrupt config.json drops the "(active)" marker but still lists every theme, matching
  // `status` and `profile list`: listing must keep working when the config is the broken thing.
  // The corruption is named on stderr and reflected in the exit code, so it is never silent.
  const configResult = tryReadConfig();
  const activeThemeId = configResult.ok ? configResult.config.activeThemeId : null;
  if (!configResult.ok) {
    reportConfigCorrupt(configResult.error);
  }

  // Not reachable while the four built-in themes ship with the package, but this is the only
  // correct behaviour if user-theme filtering is ever added, and it costs one branch.
  if (entries.length === 0) {
    console.log(
      emptyState(
        "No themes available.",
        "Reinstall NIGHTSHIFT, or add a theme JSON file to your user themes directory.",
      ),
    );
    return;
  }

  console.log(
    renderTable(
      ["", "ID", "Name", "Source"],
      entries.map(({ theme, source }) => {
        const activeTag = theme.id === activeThemeId ? ` ${chalk.green("(active)")}` : "";
        const name = theme.description
          ? `${theme.name}${activeTag}\n${chalk.gray(theme.description)}`
          : `${theme.name}${activeTag}`;
        return [
          chalk.hex(theme.colors.primary)("■"),
          chalk.cyan(theme.id),
          name,
          chalk.gray(source),
        ];
      }),
    ),
  );
}

export function runThemePreview(id: string): void {
  const theme = getTheme(id);
  if (!theme) {
    failWith(
      `No theme found with id "${id}".`,
      "Run `nightshift theme list` to see available themes.",
    );
    return;
  }

  // The swatch carries its own hex as the label so the preview still conveys the palette when
  // color is off (NO_COLOR, --no-color, or a piped stream), where a background-only swatch
  // renders as blank space.
  const swatch = (hex: string, label: string) =>
    chalk.bgHex(hex).hex("#000000")(` ${label} ${hex} `);
  console.log(chalk.bold(theme.name));
  if (theme.description) console.log(chalk.gray(theme.description));
  console.log();
  console.log(
    [
      swatch(theme.colors.background, "bg"),
      swatch(theme.colors.foreground, "fg"),
      swatch(theme.colors.primary, "primary"),
      swatch(theme.colors.secondary, "secondary"),
      swatch(theme.colors.success, "success"),
      swatch(theme.colors.warning, "warning"),
      swatch(theme.colors.error, "error"),
    ].join(" "),
  );

  console.log();
  printContrastReport(theme);
}

/**
 * The contrast table plus its advisory, for one theme.
 *
 * Shared by `theme preview` and `theme edit` rather than written twice: `edit` has to show the
 * ratios *before* it writes, and they must be the same numbers, the same thresholds and the same
 * "advisory only" framing the user already read in `preview` - a second rendering would be a
 * second opinion about the same audit.
 */
function printContrastReport(theme: Theme): void {
  console.log(chalk.bold(`Contrast against background ${theme.colors.background} (WCAG 2.x)`));
  const results = auditThemeContrast(theme);
  console.log(
    renderTable(
      ["", "Role", "Color", "Ratio", "WCAG AA"],
      results.map((r) => [
        r.passesBody ? chalk.green("✓") : r.passesLargeOnly ? chalk.yellow("!") : chalk.red("✗"),
        r.role,
        r.hex,
        `${r.ratio.toFixed(2)}:1`,
        r.passesBody
          ? chalk.green("pass (body text)")
          : r.passesLargeOnly
            ? chalk.yellow(`large text only (>=${WCAG_AA_LARGE}:1)`)
            : chalk.red(`fail (needs >=${WCAG_AA_BODY}:1)`),
      ]),
    ),
  );

  const failing = results.filter((r) => !r.passesBody);
  if (failing.length > 0) {
    const largeOnly = failing.filter((r) => r.passesLargeOnly);
    const belowLarge = failing.filter((r) => !r.passesLargeOnly);
    const hint =
      belowLarge.length === 0
        ? `Usable for large or bold text (>=${WCAG_AA_LARGE}:1), but not for body text.`
        : `${belowLarge.map((r) => r.role).join(", ")} fall below even the ${WCAG_AA_LARGE}:1 large-text minimum` +
          (largeOnly.length > 0
            ? `; ${largeOnly.map((r) => r.role).join(", ")} are large-text only.`
            : ".");
    console.log(
      warnMessage(
        `${failing.length} color${failing.length === 1 ? "" : "s"} below WCAG AA ${WCAG_AA_BODY}:1 for body text: ${failing.map((r) => r.role).join(", ")}.`,
        hint,
      ),
    );
  }
}

export function runThemeApply(id: string, options: { dryRun?: boolean | undefined } = {}): void {
  if (options.dryRun) {
    printApplyPreview(
      buildApplyPreview(id, `theme apply ${id}`),
      "Run `nightshift theme list` to see available themes, or `nightshift doctor` to check your environment.",
    );
    return;
  }

  const result = applyThemeToWindowsTerminal(id);
  if (result.ok) {
    console.log(successMessage(result.message));
  } else {
    failWith(result.message, "Run `nightshift doctor` to check your environment.");
  }
}

/**
 * One schema issue per line, field path first.
 *
 * Shared by `theme validate` and `theme edit` so a bad hex is reported identically whichever
 * command found it - the field path is the part a user acts on, and two formatters would start
 * by agreeing and end by not.
 */
function formatIssues(issues: ThemeIssue[]): string {
  return issues.map((i) => `    ${chalk.cyan(i.path)}: ${i.message}`).join("\n");
}

/**
 * Reports every schema issue at once, then the contrast advisories separately.
 *
 * The two are deliberately rendered with different glyphs and a line saying so: a schema issue
 * means the file cannot be used, a contrast warning means it can be used but will be hard to
 * read. Collapsing them into one list would make a dim-but-legal theme look broken.
 */
export function runThemeValidate(file: string): void {
  const result = validateThemeFile(file);

  if (!result.ok) {
    // No issues means the file never reached the schema - unreadable, unparseable, or oversized -
    // so "fix the fields listed above" would point at a list that isn't there.
    if (result.issues.length === 0) {
      failWith(
        result.message,
        "Check the path, and that the file is a readable JSON theme. `nightshift theme create --id <id> --name <name>` writes a valid one to copy from.",
      );
      return;
    }
    failWith(
      `${result.message}\n${formatIssues(result.issues)}`,
      "Fix every field listed above, then re-run. `nightshift theme create --id <id> --name <name>` writes a valid file to copy from.",
    );
    return;
  }

  console.log(successMessage(result.message));
  if (result.warnings.length > 0) {
    console.log(
      warnMessage(
        `${result.warnings.length} color${result.warnings.length === 1 ? "" : "s"} below WCAG AA ${WCAG_AA_BODY}:1 against the theme background: ` +
          result.warnings.map((r) => `${r.role} ${r.ratio.toFixed(2)}:1`).join(", ") +
          ".",
        "Advisory only - the theme is valid and can be applied as-is. Raise these for readable body text.",
      ),
    );
  }
}

export function runThemeCreate(options: {
  id: string;
  name: string;
  from?: string | undefined;
  description?: string | undefined;
  overwrite?: boolean | undefined;
}): void {
  const result = createTheme(options);
  if (!result.ok) {
    // Suggesting --overwrite is only honest for the one refusal it actually lifts. Offering it
    // against a built-in id would contradict the message directly above it ("cannot be
    // overwritten"), which is how a hint stops being trusted.
    const hint = result.message.includes("--overwrite")
      ? "Re-run with --overwrite to replace your own theme, or pick a different --id."
      : "Run `nightshift theme list` to see the ids already in use and the ids you can clone with --from.";
    failWith(result.message, hint);
    return;
  }
  console.log(successMessage(result.message));
  console.log(chalk.gray(`Wrote ${result.path}`));
  console.log();
  console.log(
    `Edit the file, then run ${chalk.cyan(`nightshift theme validate "${result.path}"`)} and ${chalk.cyan(`nightshift theme apply ${options.id}`)}.`,
  );
}

/**
 * `theme edit <id> --set <role>=<#RRGGBB>` - change a colour without opening the JSON.
 *
 * Scriptable first: every refusal and the whole report are driven by `--set`, so the feature is
 * exercisable (and tested) with no TTY, and the interactive menu action is a wrapper that
 * collects one `role=value` pair and calls this. The reverse - prompting first and bolting on a
 * flag later - is what produces a feature only a human can reach.
 *
 * The new contrast ratios are printed *before* the write in both modes, because the question
 * "is this still readable" is only useful at the moment the colour changes. They stay advisory:
 * a failing ratio is shown and the write still happens, which is the rule `theme validate`
 * already follows.
 */
export function runThemeEdit(
  id: string,
  options: { set?: string[] | undefined; dryRun?: boolean | undefined } = {},
): void {
  const set = options.set ?? [];
  const result = editTheme({ id, set, dryRun: options.dryRun });

  if (!result.ok) {
    if (result.issues.length > 0) {
      failWith(
        `${result.message}\n${formatIssues(result.issues)}`,
        "Every colour is a 6-digit hex string, e.g. #1A2B3C. Nothing was written.",
      );
      return;
    }
    // Each refusal with a specific remedy gets that remedy, rather than the generic listing
    // hint. Offering the clone is the whole answer for a built-in: it is what the user is
    // actually trying to do, and `theme create --from` already does it.
    const hint = result.message.includes("built-in theme")
      ? `Clone it into your own themes first: \`nightshift theme create --id my-${id} --name "My ${id}" --from ${id}\`, then edit that.`
      : /is not a colour role|role=value|No colour given/.test(result.message)
        ? `Pass at least one \`--set <role>=<#RRGGBB>\`, e.g. \`--set primary=#1A2B3C\`. \`nightshift theme preview ${id}\` shows the palette and its role names.`
        : "Run `nightshift theme list` to see which themes are your own - only user themes can be edited.";
    failWith(result.message, hint);
    return;
  }

  const width = Math.max(...result.changes.map((c) => c.path.length));
  const subject = `theme edit ${id} ${result.changes.map((c) => `--set ${c.role}=${c.to}`).join(" ")}`;
  console.log(
    options.dryRun
      ? `${chalk.bold("Dry run")} ${chalk.gray(`- \`${subject}\` would change:`)}`
      : successMessage(result.message),
  );
  console.log();
  // Named in both modes, for the reason `theme apply --dry-run` names its target: "which file"
  // is half of "what would this do".
  console.log(`  ${chalk.gray(result.path)}`);
  console.log();
  for (const c of result.changes) {
    console.log(
      `  ${chalk.yellow("~")} ${chalk.cyan(c.path.padEnd(width))}  ${chalk.gray(c.from)} ${chalk.gray("->")} ${chalk.hex(c.to)("■")} ${c.to}`,
    );
  }
  console.log();
  // The theme in the result is the *edited* one (an `ok` result always carries it), so these are
  // the ratios after the change, which is the only version worth showing before a write.
  printContrastReport(result.theme as Theme);
  console.log();

  if (options.dryRun) {
    console.log(
      emptyState(
        "Nothing was written - the theme file is unchanged.",
        `Re-run without --dry-run to save: \`nightshift ${subject}\``,
      ),
    );
    return;
  }
  // Editing the file does not re-apply it: Windows Terminal keeps the colours from the last
  // apply until the theme is applied again, so a user who edits the active theme and sees no
  // change in their terminal is looking at exactly this gap.
  console.log(`Run ${chalk.cyan(`nightshift theme apply ${id}`)} to see this in Windows Terminal.`);
}

export function runThemeRemove(id: string): void {
  const result = removeTheme(id);
  if (result.ok) {
    console.log(successMessage(result.message));
    return;
  }
  // The "it is active" refusal is the one case with a specific remedy, so it gets one rather
  // than the generic listing hint.
  const hint = result.message.includes("is the active theme")
    ? "Switch away first with `nightshift theme apply <other-id>`, then remove it."
    : "Run `nightshift theme list` to see which themes are user-created - built-in themes cannot be removed.";
  failWith(result.message, hint);
}
