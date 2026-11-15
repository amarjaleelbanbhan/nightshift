import chalk from "chalk";
import { resolveApplyTarget } from "../../core/themes/apply.js";
import {
  readWindowsTerminalSettings,
  mergeThemeIntoSettings,
} from "../../adapters/windows-terminal/apply.js";
import { describeSettingsTarget } from "../../adapters/windows-terminal/locate.js";
import { getBackupsDir } from "../../core/config/paths.js";
import { findInstalledFont } from "../../core/fonts/detect.js";
import { failWith, warnMessage, emptyState } from "../ui/feedback.js";

/**
 * `--dry-run` for `theme apply` and `profile apply`: what the write would change, before it
 * changes it.
 *
 * `setup` is the pattern this copies, for the reason `setup` has it. `ROADMAP_STATUS.md` says
 * anything writing outside NIGHTSHIFT's own config directory must show a specific proposal
 * first, and `theme apply` performs exactly the write `setup` step 3 asks permission for while
 * showing nothing (#31). As in `setup`, the building and the rendering are separate functions
 * that perform no writes at all, so the preview path is *structurally* incapable of modifying
 * the file rather than merely choosing not to.
 *
 * Shared by both command modules rather than written twice: the preview must stay identical to
 * the write it describes, and two copies would drift from each other before they drifted from
 * the engine.
 *
 * What is deliberately *not* here: interactivity. `theme apply` is used in scripts, so
 * `--dry-run` is opt-in and the default behaviour is unchanged.
 */

/** One key `mergeThemeIntoSettings` touches, and what it would become. */
export interface PreviewChange {
  /** The key path inside settings.json, as a user would find it in the file. */
  path: string;
  /**
   * `add` when the key is absent today, `replace` when it holds a different value, and
   * `unchanged` when the merge writes the same value that is already there.
   *
   * `unchanged` exists because the merge really does write those keys, so omitting them would
   * under-report what the command touches - but calling them `replace` reads as `14 -> 14`,
   * which is noise in the one command whose whole purpose is saying precisely what changes. A
   * preview that lists non-changes trains the reader to skim it.
   */
  action: "add" | "replace" | "unchanged";
  /** The current value, when there is one to show. */
  from?: string;
  /** The value that would be written. */
  to: string;
}

export interface ApplyPreview {
  /** The command being previewed, e.g. `theme apply ghost-protocol`. */
  subject: string;
  themeName: string;
  /** The resolved settings.json, naming the symlink when the located path was one (#27). */
  target: string;
  backupsDir: string;
  changes: PreviewChange[];
  /** Set when the theme names a font family that is not installed. */
  fontWarning?: string;
}

export type ApplyPreviewResult =
  { ok: true; preview: ApplyPreview } | { ok: false; message: string };

/** A settings.json value that is really there, rather than absent or JSON `null`. */
function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function plainObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function quoteOrOmit(value: unknown): string | undefined {
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return isPresent(value) ? `(a ${Array.isArray(value) ? "list" : typeof value})` : undefined;
}

/** Key-order-independent structural comparison, so a hand-reordered file is not a false change. */
function sameValue(a: unknown, b: unknown): boolean {
  const stable = (v: unknown): string =>
    JSON.stringify(v, (_k, val) =>
      val !== null && typeof val === "object" && !Array.isArray(val)
        ? Object.fromEntries(
            Object.entries(val as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)),
          )
        : val,
    );
  return stable(a) === stable(b);
}

/**
 * Compares the scheme entry the merge produced against the one already in the file.
 *
 * Presence of the name is not enough: re-applying the active theme leaves the scheme byte
 * identical, and reporting that as `replace` made the "nothing would change" case unreachable.
 */
function schemeAction(
  existingSchemes: unknown[],
  mergedSchemes: unknown,
  name: string,
): PreviewChange["action"] {
  const byName = (list: unknown[]): unknown => list.find((s) => plainObject(s).name === name);
  const before = byName(existingSchemes);
  if (before === undefined) return "add";
  const after = byName(Array.isArray(mergedSchemes) ? mergedSchemes : []);
  return sameValue(before, after) ? "unchanged" : "replace";
}

function change(path: string, current: unknown, to: string): PreviewChange {
  const from = quoteOrOmit(current);
  if (from === undefined) return { path, action: "add", to };
  // Both sides are already formatted by quoteOrOmit, so comparing the rendered strings is
  // type-agnostic: it works for the string colorScheme and the numeric font.size alike,
  // without needing to know which is which here.
  if (from === to) return { path, action: "unchanged", from, to };
  return { path, action: "replace", from, to };
}

/**
 * Computes what applying `themeId` would change. Reads the current settings.json so an added
 * key can be told from a replaced one, and writes nothing.
 *
 * Returns the same refusals as the apply engine, with the same messages: an unknown theme id
 * is still an error under `--dry-run` (the user asked about a theme that does not exist), and a
 * settings.json the merge would refuse is reported here rather than discovered on the write.
 */
export function buildApplyPreview(themeId: string, subject: string): ApplyPreviewResult {
  const resolved = resolveApplyTarget(themeId);
  if (!resolved.ok) return resolved;
  const { theme, target } = resolved;

  let current: Record<string, unknown>;
  let merged: Record<string, unknown>;
  try {
    current = readWindowsTerminalSettings(target.path);
    // Run the real merge. It is the only authority on whether this file can be rewritten at
    // all - it refuses a legacy array `profiles`, a string `profiles.defaults` and so on - so
    // running it here turns `--dry-run` into a genuine pre-flight check rather than a second
    // opinion about the same file. The result is also what the scheme comparison below is
    // measured against, so the preview describes the actual merge instead of re-deriving it.
    merged = mergeThemeIntoSettings(current, theme);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }

  const schemes: unknown[] = Array.isArray(current.schemes) ? current.schemes : [];
  const defaults = plainObject(plainObject(current.profiles).defaults);
  const font = plainObject(defaults.font);

  const changes: PreviewChange[] = [
    {
      path: `schemes[] (name "${theme.name}")`,
      action: schemeAction(schemes, merged.schemes, theme.name),
      to: `background ${theme.colors.background}, foreground ${theme.colors.foreground} + 16 ANSI colors`,
    },
    change("profiles.defaults.colorScheme", defaults.colorScheme, `"${theme.name}"`),
  ];

  const preview: ApplyPreview = {
    subject,
    themeName: theme.name,
    target: describeSettingsTarget(target),
    backupsDir: getBackupsDir(),
    changes,
  };

  if (theme.typography) {
    const { family, size } = theme.typography;
    changes.push(
      change("profiles.defaults.font.face", font.face, `"${family}"`),
      change("profiles.defaults.font.size", font.size, String(size)),
    );

    // The missing-font warning `doctor` reports, moved to the moment it is actionable: applying
    // a theme whose font is absent is when a user would want to know, not later when the
    // terminal silently looks wrong. `findInstalledFont` stops at the first match instead of
    // parsing all ~360 font files, so this costs ~15 ms for an installed family rather than the
    // ~1.5 s `font list` takes.
    const lookup = findInstalledFont(family);
    if (lookup.support === "supported" && !lookup.match) {
      preview.fontWarning =
        `"${family}" is not installed, so Windows Terminal will silently substitute ` +
        "another font and the result will not match `nightshift theme preview`.";
    }
  }

  return { ok: true, preview };
}

/** Renders the preview as the list of writes it describes. Writes nothing. */
export function renderApplyPreview(preview: ApplyPreview): string {
  const width = Math.max(...preview.changes.map((c) => c.path.length));
  const effective = preview.changes.filter((c) => c.action !== "unchanged");
  const nothingWouldChange = effective.length === 0;

  const lines = [
    nothingWouldChange
      ? `${chalk.bold("Dry run")} ${chalk.gray(`- \`${preview.subject}\` would change nothing:`)}`
      : `${chalk.bold("Dry run")} ${chalk.gray(`- \`${preview.subject}\` would change:`)}`,
    "",
    `  ${preview.target}`,
    `  ${chalk.gray(`-> backed up first into ${preview.backupsDir}`)}`,
    "",
  ];

  for (const c of preview.changes) {
    const marker =
      c.action === "add"
        ? chalk.green("+ add    ")
        : c.action === "replace"
          ? chalk.yellow("~ replace")
          : chalk.gray("= same   ");
    const value =
      c.action === "unchanged"
        ? chalk.gray(c.to)
        : c.from
          ? `${chalk.gray(c.from)} ${chalk.gray("->")} ${c.to}`
          : c.to;
    lines.push(`  ${marker}  ${chalk.cyan(c.path.padEnd(width))}  ${value}`);
  }

  if (nothingWouldChange) {
    // Worth stating outright rather than leaving the reader to infer it from a list of
    // `= same` lines: "this theme is already applied" is a genuinely useful answer to
    // "what would this do", and it is the whole result in that case.
    lines.push(
      "",
      chalk.gray(
        `"${preview.themeName}" is already applied to that file - every key the merge writes already holds the value it would write.`,
      ),
    );
  }

  lines.push(
    "",
    chalk.gray("Every other key in that file is preserved untouched."),
    chalk.gray("The write is verified after it lands, and rolled back on failure."),
  );
  return lines.join("\n");
}

/**
 * Prints a preview, or the refusal that stopped it. A failed preview exits 1: `--dry-run` asks
 * "what would this do", and "it would fail" is not a success.
 */
export function printApplyPreview(result: ApplyPreviewResult, failHint: string): void {
  if (!result.ok) {
    failWith(result.message, failHint);
    return;
  }
  console.log(renderApplyPreview(result.preview));
  if (result.preview.fontWarning) {
    console.log();
    console.log(
      warnMessage(
        result.preview.fontWarning,
        "Install the font family first, or run `nightshift font list` to see what is available.",
      ),
    );
  }
  console.log();
  console.log(
    emptyState(
      "Nothing was written - no settings.json change, and no backup taken.",
      `Re-run without --dry-run to apply: \`nightshift ${result.preview.subject}\``,
    ),
  );
}
