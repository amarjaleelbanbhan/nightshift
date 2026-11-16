import fs from "node:fs";
import { z } from "zod";
import { readJsonFileWithLimit } from "../../security/limits.js";
import { relativeLuminance } from "../themes/contrast.js";

/**
 * Read-only interoperability with Claude Code (#18).
 *
 * NIGHTSHIFT never writes `~/.claude/settings.json`. Writing another tool's configuration is a
 * write surface carrying the full show-the-proposal-and-approve requirement and a real blast
 * radius - a corrupted settings file breaks someone's Claude Code - and there is nothing
 * NIGHTSHIFT knows that Claude Code needs written into its config. The scope decision recorded
 * on #18 is that this stays on the read-only side permanently, not as a stepping stone.
 *
 * What *is* worth reading is one key. Claude Code has its own light/dark `theme` setting, and
 * when it disagrees with the terminal's background the result renders badly - light-theme
 * syntax colors on a dark background, washed out and in places unreadable. The cause is
 * non-obvious when you hit it: you changed your *terminal* theme and a *different tool* started
 * looking wrong. So NIGHTSHIFT names the mismatch and leaves the fix to the user, in the tool
 * that owns the setting.
 */

/**
 * Deliberately not a strict object, and deliberately only one key.
 *
 * Zod strips unknown keys by default, which is the property wanted here: the file can hold
 * `env`, `permissions` and `hooks`, any of which may contain a token. Parsing to exactly one
 * field means nothing else can reach a `doctor` report that users paste into bug threads.
 * `strictObject` would be actively wrong - it would *reject* a settings file for containing
 * the keys Claude Code puts there.
 */
const claudeSettingsSchema = z.object({
  theme: z.string().optional(),
});

/** What reading the file produced. Modelled as states because all three print differently. */
export type ClaudeCodeSettings =
  | { state: "absent" }
  /** Present but unusable: too large, not JSON, or `theme` is not a string. */
  | { state: "unreadable"; detail: string }
  | { state: "read"; theme: string | null };

/**
 * Reads the single key NIGHTSHIFT has a reason to read.
 *
 * Treated as untrusted input even though the user owns it - the same rule every other JSON read
 * in this project follows, and the reason `readJsonFileWithLimit` exists. A hand-edited or
 * half-written settings file must produce a reportable string, not a crash in the one command
 * people run when something is already wrong.
 */
export function readClaudeCodeSettings(settingsPath: string | null): ClaudeCodeSettings {
  if (!settingsPath || !fs.existsSync(settingsPath)) return { state: "absent" };

  let raw: unknown;
  try {
    raw = readJsonFileWithLimit(settingsPath);
  } catch (error) {
    return { state: "unreadable", detail: (error as Error).message };
  }

  const parsed = claudeSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") || "(root)";
    return { state: "unreadable", detail: `${where}: ${issue?.message ?? "invalid"}` };
  }
  return { state: "read", theme: parsed.data.theme ?? null };
}

export type Appearance = "dark" | "light";

/**
 * Claude Code's theme ids are `dark`, `light`, and variants (`dark-daltonized`,
 * `light-ansi`, ...). Matching on the prefix rather than an enumerated list is deliberate: a
 * variant this project has never heard of still answers the only question being asked, and
 * hard-coding the list would turn Claude Code shipping a new one into a false mismatch report.
 */
export function claudeThemeAppearance(theme: string | null): Appearance | null {
  if (theme === null) return null;
  if (theme.startsWith("dark")) return "dark";
  if (theme.startsWith("light")) return "light";
  return null;
}

/**
 * 0.179 is the WCAG relative-luminance midpoint - the value at which black and white text have
 * equal contrast against the background, and therefore the standard place to split "this is a
 * dark background" from "this is a light one". Reuses the luminance maths the contrast audit
 * already computes rather than adding a second notion of brightness.
 */
export function backgroundAppearance(backgroundHex: string): Appearance {
  return relativeLuminance(backgroundHex) < 0.179 ? "dark" : "light";
}
