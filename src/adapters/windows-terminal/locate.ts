import fs from "node:fs";
import path from "node:path";
import { NightshiftError } from "../../cli/errors.js";

/**
 * Windows Terminal stores settings.json under a package-specific LocalState
 * folder when installed from the Microsoft Store, or under a flat
 * %LOCALAPPDATA%\Microsoft\WindowsTerminal folder for unpackaged/portable
 * builds. Both are real, documented install paths, so we check each rather
 * than assuming one.
 */
const CANDIDATE_SUFFIXES = [
  "Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json",
  "Packages/Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe/LocalState/settings.json",
  "Microsoft/WindowsTerminal/settings.json",
];

export function locateWindowsTerminalSettings(): string | null {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;

  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = path.join(localAppData, ...suffix.split("/"));
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** A located settings.json, resolved through any symlink the user put in the way. */
export interface SettingsTarget {
  /** The real file to read, back up and write. */
  path: string;
  /** The symlink followed to reach `path`, or null when the located path was not a link. */
  linkPath: string | null;
}

/**
 * Resolves a located settings.json to the file that must actually be written.
 *
 * A settings.json symlinked into a dotfiles repository is a common - arguably the most likely -
 * setup among this tool's users, and `atomicWriteFileSync` *renames over* its target, which
 * replaces the link rather than the file it points at. Writing the link path therefore severed
 * the link and left the user's tracked file holding stale content while the apply reported
 * success (#27).
 *
 * This follows the link rather than refusing it (as `restoreBackup`, `createTheme` and
 * `importProfile` do for destinations that come *out of* a file). A symlink here is a deliberate
 * act by the user meaning "this file lives elsewhere", so honouring it respects an instruction;
 * refusing would make `theme apply` unusable for exactly the people most likely to theme their
 * terminal. Callers must report `describeSettingsTarget()` rather than the path they passed in -
 * writing somewhere other than the path you told the user about is the same defect in a
 * different costume.
 *
 * Throws rather than returning a broken-link state: nothing downstream can proceed, and a
 * `NightshiftError` already renders as `✗ message` plus a `→ hint` through the top-level
 * handler. The dangling case is the window between detection and the write - widest under
 * `setup`, which prints its proposal and then waits for confirmation.
 */
export function resolveSettingsTarget(located: string): SettingsTarget {
  // The link's own recorded target, read up front and used only in the message below - never
  // as a path. Reading it here rather than in the failure branch keeps the dangling-link
  // message from needing a second `readlinkSync` that could itself throw.
  let linkTarget: string | null = null;
  try {
    if (fs.lstatSync(located).isSymbolicLink()) linkTarget = fs.readlinkSync(located);
  } catch {
    // Vanished since it was located. Not this function's error to report: the read that
    // follows in the caller names the file and the operation precisely.
  }
  if (linkTarget === null) return { path: located, linkPath: null };

  try {
    return { path: fs.realpathSync(located), linkPath: located };
  } catch {
    throw new NightshiftError(
      `Windows Terminal's settings.json at "${located}" is a symlink pointing at ` +
        `"${linkTarget}", which does not exist.`,
      undefined,
      "Restore the file the link points at, or delete the link and open Windows Terminal once " +
        "to let it recreate settings.json.",
    );
  }
}

/** Names the file that is really written, and the link it was reached through when they differ. */
export function describeSettingsTarget(target: SettingsTarget): string {
  return target.linkPath ? `${target.path} (via the symlink ${target.linkPath})` : target.path;
}

/**
 * Display form of a located settings.json for commands that only report, never write
 * (`status`, `doctor`). Those two are what a user runs *because* something is wrong, so a
 * dangling link is labelled rather than thrown.
 */
export function describeSettingsPath(located: string): string {
  try {
    return describeSettingsTarget(resolveSettingsTarget(located));
  } catch {
    return `${located} (broken symlink)`;
  }
}
