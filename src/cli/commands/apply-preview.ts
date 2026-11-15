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
  /** `add` when the key is absent today, `replace` when it holds a value already. */
  action: "add" | "replace";
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

function change(path: string, current: unknown, to: string): PreviewChange {
  const from = quoteOrOmit(current);
  return from === undefined ? { path, action: "add", to } : { path, action: "replace", from, to };
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
  try {
    current = readWindowsTerminalSettings(target.path);
    // Run the real merge and throw the result away. It is the only authority on whether this
    // file can be rewritten at all - it refuses a legacy array `profiles`, a string
    // `profiles.defaults` and so on - and running it here turns `--dry-run` into a genuine
    // pre-flight check instead of a second opinion about the same file.
    mergeThemeIntoSettings(current, theme);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }

  const schemes: unknown[] = Array.isArray(current.schemes) ? current.schemes : [];
  const defaults = plainObject(plainObject(current.profiles).defaults);
  const font = plainObject(defaults.font);

  const changes: PreviewChange[] = [
    {
      path: `schemes[] (name "${theme.name}")`,
      action: schemes.some((s) => plainObject(s).name === theme.name) ? "replace" : "add",
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
  const lines = [
    `${chalk.bold("Dry run")} ${chalk.gray(`- \`${preview.subject}\` would change:`)}`,
    "",
    `  ${preview.target}`,
    `  ${chalk.gray(`-> backed up first into ${preview.backupsDir}`)}`,
    "",
  ];

  for (const c of preview.changes) {
    const marker = c.action === "add" ? chalk.green("+ add    ") : chalk.yellow("~ replace");
    const value = c.from ? `${chalk.gray(c.from)} ${chalk.gray("->")} ${c.to}` : c.to;
    lines.push(`  ${marker}  ${chalk.cyan(c.path.padEnd(width))}  ${value}`);
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
