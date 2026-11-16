import fs from "node:fs";
import os from "node:os";
import { createBackup, restoreBackup } from "../../backup/manager.js";
import { MAX_SHELL_PROFILE_BYTES } from "../../security/limits.js";
import { atomicWriteFileSync } from "../../utils/atomicWrite.js";
import { tryReadConfig } from "../config/store.js";
import {
  detectShell,
  detectStarship,
  profilePathFor,
  resolveShellProfile,
  SHELL_LABELS,
  type ShellId,
  type ShellProfileTarget,
  type StarshipDetection,
} from "./detect.js";
import type { SupportLevel } from "../capabilities/detect.js";

/**
 * The write half of shell integration: one clearly delimited managed block in the user's
 * PowerShell profile.
 *
 * This is the highest blast radius in the product. A corrupt `settings.json` costs a user their
 * terminal colours; a corrupt `$PROFILE` can cost them a working shell, which is the tool they
 * would use to fix it. Five decisions follow from that and should not be "improved" without
 * reading this.
 *
 * **Planning writes nothing.** `buildShellIntegrationPlan()` reads the profile, detects the
 * shell and Starship, and computes the exact bytes it *would* write; it never creates or
 * modifies a file. Only `executeShellIntegration()` writes, and the CLI calls it solely after
 * approval - the same structure as `setup` and `font install`, for the same reason.
 *
 * **The whole file is a value, not a stream of edits.** The next content is computed as
 * `before + block + after`, where `before` and `after` are verbatim slices of the current file.
 * Every byte outside the block region therefore survives by construction, not by a regex
 * getting the right answer - including comments, blank lines, key order and the file's own line
 * endings.
 *
 * **The markers are the contract.** `# >>> nightshift >>>` / `# <<< nightshift <<<` delimit the
 * region NIGHTSHIFT owns. A second run replaces that region's contents rather than appending,
 * so repeated runs are byte-identical; removal deletes exactly that region. A file with two
 * blocks, or a start marker with no end, is **refused** rather than guessed at.
 *
 * **Nothing is interpolated unvalidated.** The block is PowerShell source that the user's shell
 * executes on every start, so it is a code-execution sink. The only value that reaches it is the
 * active theme id, which is re-validated against `[a-z0-9-]+` here even though the theme schema
 * already enforces it - `config.json`'s `activeThemeId` is a hand-editable string field, and
 * "it was validated somewhere else" is not a property of the file on disk.
 *
 * **Starship is detected, not configured.** The block gets a guarded Starship init line when the
 * binary is on PATH. Generating a `starship.toml` from a NIGHTSHIFT theme is **not implemented**
 * and is reported as such everywhere it could be mistaken for done.
 */

export const BLOCK_START = "# >>> nightshift >>>";
export const BLOCK_END = "# <<< nightshift <<<";

/** Same shape the theme schema enforces. Re-checked because `config.json` is editable by hand. */
const THEME_ID_PATTERN = /^[a-z0-9-]+$/;

export type ShellAction = "add" | "replace" | "remove";

/** A managed block found in a file, as character offsets into it. */
interface ManagedBlock {
  /** Offset of the first character of the start-marker line. */
  start: number;
  /** Offset just past the end-marker line's terminator (or the end of the file). */
  end: number;
  lines: string[];
}

type BlockScan =
  | { kind: "absent" }
  | { kind: "found"; block: ManagedBlock }
  | { kind: "invalid"; message: string };

/** Offsets of every line that consists solely of `marker`. */
function markerLines(text: string, marker: string): number[] {
  const found: number[] = [];
  for (let index = text.indexOf(marker); index !== -1; index = text.indexOf(marker, index + 1)) {
    if (index !== 0 && text[index - 1] !== "\n") continue;
    const lineEnd = text.indexOf("\n", index);
    const rest = text.slice(index + marker.length, lineEnd === -1 ? undefined : lineEnd);
    // A trailing CR or spaces still count as the marker's own line; anything else means the
    // marker is embedded in a line that says something more, which is not NIGHTSHIFT's block.
    if (/^[ \t\r]*$/.test(rest)) found.push(index);
  }
  return found;
}

/**
 * Finds NIGHTSHIFT's managed block.
 *
 * Returns `invalid` rather than picking one for the two shapes that mean something already went
 * wrong: more than one block (an older version that appended instead of replacing), and a start
 * marker with no end (a half-written file, or a user who deleted one line). Both are recoverable
 * by hand and unrecoverable by guessing, so this refuses and names the file.
 */
export function findManagedBlock(text: string): BlockScan {
  const starts = markerLines(text, BLOCK_START);
  const ends = markerLines(text, BLOCK_END);

  if (starts.length === 0 && ends.length === 0) return { kind: "absent" };
  if (starts.length > 1 || ends.length > 1) {
    return {
      kind: "invalid",
      message: `found ${starts.length} "${BLOCK_START}" and ${ends.length} "${BLOCK_END}" markers, so NIGHTSHIFT cannot tell which block is its own`,
    };
  }

  const start = starts[0];
  const end = ends[0];
  if (start === undefined || end === undefined || end < start) {
    return {
      kind: "invalid",
      message: `the "${BLOCK_START}" and "${BLOCK_END}" markers are not a matched pair in that order`,
    };
  }

  const terminator = text.indexOf("\n", end);
  const blockEnd = terminator === -1 ? text.length : terminator + 1;
  return {
    kind: "found",
    block: { start, end: blockEnd, lines: splitLines(text.slice(start, blockEnd)) },
  };
}

/** Splits into lines without inventing a trailing empty one for a newline-terminated string. */
function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * The block's contents.
 *
 * Deliberately short. Everything in here runs on every single shell start, so each line has to
 * earn its place: an environment variable other tooling (and the user's own prompt) can read,
 * and the Starship init line that is the point of the feature. The Starship line is wrapped in
 * a `Get-Command` guard so that uninstalling Starship later degrades to doing nothing rather
 * than printing an error on every new shell - the failure mode of an unguarded init line.
 */
export function buildBlockLines(themeId: string | null, starship: StarshipDetection): string[] {
  const lines = [
    BLOCK_START,
    "# Managed by NIGHTSHIFT. Everything between these markers is replaced by",
    "# `nightshift shell init` and deleted by `nightshift shell remove`. Edit outside them.",
  ];
  if (themeId) {
    lines.push(`$env:NIGHTSHIFT_THEME = "${themeId}"`);
  }
  if (starship.binary) {
    lines.push(
      "if (Get-Command starship -ErrorAction SilentlyContinue) {",
      "  Invoke-Expression (&starship init powershell)",
      "}",
    );
  }
  lines.push(BLOCK_END);
  return lines;
}

export interface ShellIntegrationPlan {
  /** `supported` only when a PowerShell profile path was identified; see `detectShell`. */
  support: SupportLevel;
  platform: NodeJS.Platform;
  shell: ShellId | null;
  shellLabel: string | null;
  /** What identified the shell, printed verbatim so the user can disagree with it. */
  evidence: string;
  /** A non-PowerShell shell this environment advertises, reported and never written to. */
  otherShell: string | null;
  target: ShellProfileTarget | null;
  action: ShellAction;
  /** The file as it is now; `""` when it does not exist. */
  originalText: string;
  /** Exactly the bytes that would be written. */
  nextText: string;
  /** Block lines that disappear, for the diff. */
  removedLines: string[];
  /** Block lines that appear, for the diff. */
  addedLines: string[];
  contextBefore: string[];
  contextAfter: string[];
  /** The file's own line ending, preserved; CRLF for a new file on Windows. */
  eol: string;
  starship: StarshipDetection;
  themeId: string | null;
  /** True when the write would be a no-op, so the CLI can say so instead of writing. */
  unchanged: boolean;
  /** Why this plan cannot be executed, or null when it can. */
  problem: string | null;
}

function refuse(
  support: SupportLevel,
  platform: NodeJS.Platform,
  problem: string | null,
  extra: Partial<ShellIntegrationPlan> = {},
): ShellIntegrationPlan {
  return {
    support,
    platform,
    shell: null,
    shellLabel: null,
    evidence: "",
    otherShell: process.env.SHELL ?? null,
    target: null,
    action: "add",
    originalText: "",
    nextText: "",
    removedLines: [],
    addedLines: [],
    contextBefore: [],
    contextAfter: [],
    eol: os.platform() === "win32" ? "\r\n" : "\n",
    starship: { binary: null, configPath: null, configExists: false },
    themeId: null,
    unchanged: false,
    problem,
    ...extra,
  };
}

/** The last `count` lines of the text before the block, for diff context. */
function tailLines(text: string, count: number): string[] {
  const lines = splitLines(text);
  return lines.slice(Math.max(0, lines.length - count));
}

/**
 * Describes what `shell init` or `shell remove` *would* write. Writes nothing - not even the
 * profile's parent directory.
 */
export function buildShellIntegrationPlan(intent: "init" | "remove"): ShellIntegrationPlan {
  const detection = detectShell();
  const starship = detectStarship();

  if (detection.shell === null) {
    return refuse(
      detection.support,
      detection.platform,
      detection.support === "unsupported"
        ? `Shell integration is not implemented on ${detection.platform}.`
        : `No PowerShell profile could be located: ${detection.evidence}.`,
      { evidence: detection.evidence, otherShell: detection.otherShell, starship },
    );
  }

  const located = profilePathFor(detection.shell);
  if (located === null) {
    return refuse(
      "unknown",
      detection.platform,
      "No Documents directory could be located, so there is no $PROFILE path to write.",
      { shell: detection.shell, evidence: detection.evidence, starship },
    );
  }

  const target = resolveShellProfile(detection.shell, located);
  const partial = {
    shell: detection.shell,
    shellLabel: SHELL_LABELS[detection.shell],
    evidence: detection.evidence,
    otherShell: detection.otherShell,
    target,
    starship,
  };

  let originalText = "";
  if (target.exists) {
    // Size is checked before the read, so an oversized file is never allocated. The profile is
    // the user's own file rather than NIGHTSHIFT data, hence its own generous cap rather than
    // the 64 KB JSON limit.
    let size: number;
    try {
      size = fs.statSync(target.path).size;
    } catch (error) {
      return refuse(
        "supported",
        detection.platform,
        `Could not read "${target.path}": ${(error as Error).message}`,
        partial,
      );
    }
    if (size > MAX_SHELL_PROFILE_BYTES) {
      return refuse(
        "supported",
        detection.platform,
        `"${target.path}" is ${size} bytes, which exceeds the ${MAX_SHELL_PROFILE_BYTES}-byte limit for a shell profile NIGHTSHIFT will edit.`,
        partial,
      );
    }
    try {
      originalText = fs.readFileSync(target.path, "utf8");
    } catch (error) {
      return refuse(
        "supported",
        detection.platform,
        `Could not read "${target.path}": ${(error as Error).message}`,
        partial,
      );
    }
  }

  const scan = findManagedBlock(originalText);
  if (scan.kind === "invalid") {
    return refuse(
      "supported",
      detection.platform,
      `"${target.path}" ${scan.message}. NIGHTSHIFT will not edit it.`,
      partial,
    );
  }

  // The file's own line ending wins, so a CRLF profile does not come back half LF. A file with
  // no newline at all gets the platform's.
  const eol = originalText.includes("\r\n")
    ? "\r\n"
    : originalText.includes("\n")
      ? "\n"
      : detection.platform === "win32"
        ? "\r\n"
        : "\n";

  const config = tryReadConfig();
  const rawThemeId = config.ok ? config.config.activeThemeId : null;
  if (rawThemeId !== null && !THEME_ID_PATTERN.test(rawThemeId)) {
    // This value would be interpolated into PowerShell source the shell executes. A theme id
    // that does not match the schema's own shape is refused rather than escaped: there is no
    // legitimate way for it to be there, and escaping it would mean writing a shell quoter.
    return refuse(
      "supported",
      detection.platform,
      `NIGHTSHIFT's active theme id ("${rawThemeId}") is not a valid id, and it would be written into PowerShell source. Refusing to write it.`,
      partial,
    );
  }
  const themeId = rawThemeId;

  if (intent === "remove") {
    if (scan.kind === "absent") {
      // Not a failure: "there is no block" is the state `shell remove` exists to produce, so
      // reporting it as an error would make an idempotent command exit non-zero on the second
      // run. `unchanged` is how the CLI knows to say so and write nothing.
      return {
        ...refuse("supported", detection.platform, null, partial),
        action: "remove",
        originalText,
        nextText: originalText,
        unchanged: true,
        themeId,
        eol,
      };
    }
    const { block } = scan;
    return {
      support: "supported",
      platform: detection.platform,
      ...partial,
      action: "remove",
      originalText,
      // Exactly the block region excised; both slices are verbatim, so every other byte of the
      // user's file survives and the result is the original file back.
      nextText: originalText.slice(0, block.start) + originalText.slice(block.end),
      removedLines: block.lines,
      addedLines: [],
      contextBefore: tailLines(originalText.slice(0, block.start), 2),
      contextAfter: splitLines(originalText.slice(block.end)).slice(0, 2),
      eol,
      themeId,
      unchanged: false,
      problem: null,
    };
  }

  const addedLines = buildBlockLines(themeId, starship);
  if (themeId === null && !starship.binary) {
    return refuse(
      "supported",
      detection.platform,
      "There is nothing for the managed block to contain: no active NIGHTSHIFT theme, and no `starship` binary on PATH.",
      { ...partial, originalText, eol, themeId },
    );
  }

  let nextText: string;
  let removedLines: string[] = [];
  let contextBefore: string[];
  let contextAfter: string[];
  let action: ShellAction;
  if (scan.kind === "found") {
    const { block } = scan;
    action = "replace";
    // Whether the old block ended the file without a trailing newline is preserved, so
    // re-running on such a file does not quietly add one.
    const trailing = originalText.slice(block.start, block.end).endsWith("\n") ? eol : "";
    nextText =
      originalText.slice(0, block.start) +
      addedLines.join(eol) +
      trailing +
      originalText.slice(block.end);
    removedLines = block.lines;
    contextBefore = tailLines(originalText.slice(0, block.start), 2);
    contextAfter = splitLines(originalText.slice(block.end)).slice(0, 2);
  } else {
    action = "add";
    // Appended, never prepended: a profile's existing content often sets up the environment the
    // block's own lines may depend on, and the end of the file is the one position that cannot
    // change the meaning of anything already there.
    const separator = originalText === "" || originalText.endsWith("\n") ? "" : eol;
    nextText = originalText + separator + addedLines.join(eol) + eol;
    contextBefore = tailLines(originalText, 2);
    contextAfter = [];
  }

  return {
    support: "supported",
    platform: detection.platform,
    ...partial,
    action,
    originalText,
    nextText,
    removedLines,
    addedLines,
    contextBefore,
    contextAfter,
    eol,
    themeId,
    unchanged: nextText === originalText,
    problem: null,
  };
}

export interface ShellIntegrationResult {
  ok: boolean;
  message: string;
  backupId?: string | undefined;
  /** The file `backupId` snapshots, so a rollback names its own destination (#23). */
  backupPath?: string | undefined;
  /**
   * What actually happened to the profile after a failure, so no caller can claim an undo that
   * did not occur. This exists because the first version of this code reported "restored it"
   * on three paths where nothing had been restored: when the plan never ran, when the *backup*
   * was what failed, and when the rollback itself threw and was swallowed. For the one command
   * whose failure mode is "the user has no working shell", a comforting false claim is the
   * worst possible output.
   *
   *   - `none`     nothing was written, so there is nothing to undo.
   *   - `restored` the backup snapshot was written back over the profile.
   *   - `removed`  the profile NIGHTSHIFT itself created was deleted.
   *   - `failed`   recovery was attempted and failed. The profile may be half-edited.
   */
  recovery?: "none" | "restored" | "removed" | "failed" | undefined;
}

/**
 * Performs an approved plan: backs up, writes the computed bytes, then verifies by reading the
 * file back rather than assuming the write landed.
 *
 * The rollback is the reason this function is as long as it is. Two cases, and they need
 * different undos: a profile that existed is put back from its backup snapshot (passing the
 * path, so poisoned backup metadata cannot redirect the restore - #23), and a profile
 * NIGHTSHIFT itself created is deleted, because `createBackup` takes no snapshot of a file that
 * was not there and "restore" has nothing to restore.
 */
export function executeShellIntegration(plan: ShellIntegrationPlan): ShellIntegrationResult {
  if (plan.problem !== null || plan.target === null) {
    // Nothing was attempted, so there is nothing to undo - and saying so is the point.
    return { ok: false, message: plan.problem ?? "No shell profile to write.", recovery: "none" };
  }
  const profilePath = plan.target.path;

  let backup: ReturnType<typeof createBackup>;
  try {
    backup = createBackup(profilePath, `shell ${plan.action} (${plan.shell})`);
  } catch (error) {
    return {
      ok: false,
      message: `Failed to create a backup before editing the shell profile: ${(error as Error).message}`,
      // The backup is what failed, so no write was attempted and no backup exists to restore
      // from. This path used to be reported with "your profile was restored from the backup",
      // which named a file that had never been created.
      recovery: "none",
    };
  }

  try {
    // atomicWriteFileSync creates the parent directory and renames over the target, so a crash
    // mid-write cannot leave a half-written profile - the failure mode that would cost the user
    // their shell.
    atomicWriteFileSync(profilePath, plan.nextText);

    const written = fs.readFileSync(profilePath, "utf8");
    if (written !== plan.nextText) {
      throw new Error("verification failed: the file on disk is not what was written");
    }
    const scan = findManagedBlock(written);
    if (plan.action === "remove" && scan.kind !== "absent") {
      throw new Error("verification failed: the managed block is still present after removal");
    }
    if (plan.action !== "remove" && scan.kind !== "found") {
      throw new Error("verification failed: the managed block is not present after the write");
    }
  } catch (error) {
    // Which recovery ran is recorded, not assumed. The old code reported "and restored it"
    // unconditionally, including when the restore below threw and was swallowed - so the one
    // message a user reads while their shell may be broken was the one that could lie.
    let recovery: ShellIntegrationResult["recovery"];
    try {
      if (plan.target.exists) {
        restoreBackup(backup.id, profilePath);
        recovery = "restored";
      } else {
        fs.rmSync(profilePath, { force: true });
        recovery = "removed";
      }
    } catch {
      // The original error is still the one to report, but the user has to be told that the
      // undo did not work - this is the case where they may be left with a half-edited profile.
      recovery = "failed";
    }
    const outcome =
      recovery === "restored"
        ? "and restored it from the backup"
        : recovery === "removed"
          ? "and deleted the profile it had created"
          : "AND COULD NOT UNDO THE CHANGE";
    return {
      ok: false,
      message: `Failed to edit the shell profile ${outcome}: ${(error as Error).message}`,
      backupId: backup.id,
      backupPath: profilePath,
      recovery,
    };
  }

  const verb =
    plan.action === "remove" ? "Removed" : plan.action === "replace" ? "Updated" : "Added";
  return {
    ok: true,
    message: `${verb} NIGHTSHIFT's managed block in ${profilePath}.`,
    backupId: backup.id,
    backupPath: profilePath,
  };
}
