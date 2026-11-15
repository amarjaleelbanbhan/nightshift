import chalk from "chalk";
import { listThemes, getTheme } from "../../core/themes/registry.js";
import { tryReadConfig } from "../../core/config/store.js";
import { applyThemeToWindowsTerminal } from "../../core/themes/apply.js";
import { validateThemeFile, createTheme, removeTheme } from "../../core/themes/manager.js";
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

export function runThemeApply(id: string): void {
  const result = applyThemeToWindowsTerminal(id);
  if (result.ok) {
    console.log(successMessage(result.message));
  } else {
    failWith(result.message, "Run `nightshift doctor` to check your environment.");
  }
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
      `${result.message}\n${result.issues.map((i) => `    ${chalk.cyan(i.path)}: ${i.message}`).join("\n")}`,
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
