import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertNotSymlink, resolveSafePath } from "../../security/paths.js";
import { MAX_FONT_FILE_BYTES } from "../../security/limits.js";
import { atomicWriteFileSync } from "../../utils/atomicWrite.js";
import { fontDirectories, findInstalledFont, readFontFamilies } from "./detect.js";
// Type-only, as in detect.ts: erased at compile time, so installing a font does not pull the
// capability detector (and zod behind it) onto this path.
import type { SupportLevel } from "../capabilities/detect.js";

/**
 * The write half of font support: copy font files from a local path into the per-user font
 * directory.
 *
 * Three decisions are load bearing and should not be "improved" without reading this.
 *
 * **Local paths only, no download.** A network fetch would be this project's first network
 * operation and a documented threat-model change (`docs/SECURITY-MODEL.md` currently states
 * there is none). `font install <path>` takes a file or a directory the user already has.
 *
 * **Planning writes nothing.** `buildFontInstallPlan()` stats, reads `name` tables and resolves
 * destinations; it never creates or modifies a file. Only `executeFontInstall()` writes, and the
 * CLI calls it solely after approval - the same structure as `setup`, for the same reason.
 *
 * **A copy is not a registration, and this module does not pretend otherwise.** A per-user font
 * install on Windows is two steps: the file goes into
 * `%LOCALAPPDATA%\Microsoft\Windows\Fonts` *and* a value naming it goes under
 * `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts`. Only the first is done here: the
 * registry needs `reg.exe` or a Win32 call, and there is no child-process execution anywhere in
 * `src/` (asserted in `docs/SECURITY-MODEL.md`) and no new dependency on the table. So the plan
 * says up front that registration will not happen, and the result reports what really did -
 * never a success for the half that did not run.
 *
 * All or nothing by design: if any selected file is unreadable, oversized, or not a font, the
 * whole plan is refused with that file named, so an approved proposal describes exactly what
 * happens rather than "most of this, probably".
 */

/** Only these are installed. `.otc` is readable by the detector but vanishingly rare, and an
 * extension NIGHTSHIFT will not install is better than one it half-handles. */
export const FONT_INSTALL_EXTENSIONS = [".ttf", ".otf", ".ttc"];

/**
 * Cap on how many files one directory install may copy. A full Nerd Font release is ~100 files
 * (every weight x Mono/Propo variant), so this is generous; it exists so `font install C:\` can
 * never turn into an unbounded copy loop.
 */
const MAX_FILES_PER_INSTALL = 256;

export interface FontInstallFile {
  /** Absolute path of the file to read. */
  source: string;
  /** Absolute path in the per-user font directory it would be written to. */
  destination: string;
  /** Families the file declares, read from its sfnt `name` table. Never empty. */
  families: string[];
  /** True when a file of that name is already in the font directory and would be replaced. */
  replaces: boolean;
}

export interface FontInstallPlan {
  platform: NodeJS.Platform;
  /** `supported` only on Windows with a locatable per-user font directory; `unknown` on Windows
   * without one, `unsupported` elsewhere - the same three answers detection gives. */
  support: SupportLevel;
  /** The per-user font directory the copies would land in; null when there is none. */
  fontDir: string | null;
  files: FontInstallFile[];
  /** Every family the selected files declare, deduplicated and sorted. */
  families: string[];
  /** Why this plan cannot be executed, or null when it can. */
  problem: string | null;
}

export interface FontInstallResult {
  copied: FontInstallFile[];
  failed: Array<{ source: string; message: string }>;
  /** Detection re-run *after* the copy, per declared family. The honest answer to "did it
   * work": a copy that reported success but left nothing findable is reported as not found. */
  verified: Array<{ family: string; found: boolean }>;
}

function refuse(
  support: SupportLevel,
  platform: NodeJS.Platform,
  fontDir: string | null,
  problem: string,
): FontInstallPlan {
  return { platform, support, fontDir, files: [], families: [], problem };
}

/** The per-user font directory, which is the only one this installs into: writing to
 * `%WINDIR%\Fonts` needs elevation and would change fonts for every account on the machine. */
function userFontDir(): string | undefined {
  return fontDirectories().find((entry) => entry.source === "user")?.dir;
}

function fontFilesIn(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((entry) => FONT_INSTALL_EXTENSIONS.includes(path.extname(entry).toLowerCase()))
    .sort()
    .map((entry) => path.join(dir, entry));
}

/**
 * Describes what installing `input` *would* do. Writes nothing - not even the font directory.
 *
 * `input` is untrusted: it is validated for `..` segments, symlinks, extension, regular-file
 * status and size, and every destination is produced by `resolveSafePath` under the font
 * directory before anything is read in full.
 */
export function buildFontInstallPlan(input: string): FontInstallPlan {
  const platform = os.platform();
  if (platform !== "win32") {
    return refuse(
      "unsupported",
      platform,
      null,
      `Font installation is not implemented on ${platform}.`,
    );
  }

  const fontDir = userFontDir();
  if (!fontDir) {
    return refuse(
      "unknown",
      platform,
      null,
      "No per-user Windows font directory could be located.",
    );
  }

  // The proposal *is* the consent, so it has to name a path the reader can check. A `..` segment
  // makes the path shown depend on a working directory the reader cannot see, which is also the
  // shape every traversal attempt takes, so it is refused rather than quietly resolved.
  if (input.split(/[\\/]/).includes("..")) {
    return refuse(
      "supported",
      platform,
      fontDir,
      `"${input}" contains a ".." segment. Pass the full path of the font file or directory instead.`,
    );
  }

  const source = path.resolve(input);
  try {
    assertNotSymlink(source);
  } catch {
    return refuse(
      "supported",
      platform,
      fontDir,
      `"${source}" is a symbolic link. Pass the path of the real font file, so the proposal names the file that is actually read.`,
    );
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(source);
  } catch {
    return refuse("supported", platform, fontDir, `No file or directory found at "${source}".`);
  }

  let candidates: string[];
  if (stat.isDirectory()) {
    candidates = fontFilesIn(source);
    if (candidates.length === 0) {
      return refuse(
        "supported",
        platform,
        fontDir,
        `"${source}" contains no ${FONT_INSTALL_EXTENSIONS.join(", ")} files.`,
      );
    }
    if (candidates.length > MAX_FILES_PER_INSTALL) {
      return refuse(
        "supported",
        platform,
        fontDir,
        `"${source}" contains ${candidates.length} font files, which exceeds the ${MAX_FILES_PER_INSTALL}-file limit for one install.`,
      );
    }
  } else {
    // No separate "is it a regular file" check: anything that is not a directory still has to
    // clear the extension, size and `name`-table checks below, which is what actually decides
    // whether it can be installed.
    candidates = [source];
  }

  const files: FontInstallFile[] = [];
  for (const candidate of candidates) {
    const extension = path.extname(candidate).toLowerCase();
    if (!FONT_INSTALL_EXTENSIONS.includes(extension)) {
      return refuse(
        "supported",
        platform,
        fontDir,
        `"${candidate}" is not a font file. Only ${FONT_INSTALL_EXTENSIONS.join(", ")} files are installed.`,
      );
    }
    // Size is checked before the file is read in full, so an oversized file is never allocated.
    const size = fs.statSync(candidate).size;
    if (size > MAX_FONT_FILE_BYTES) {
      return refuse(
        "supported",
        platform,
        fontDir,
        `"${candidate}" is ${size} bytes, which exceeds the ${MAX_FONT_FILE_BYTES}-byte font install limit.`,
      );
    }
    // The same parser `font list` uses. A file with a font extension that declares no family is
    // refused here rather than copied: installing it could not be verified afterwards, and an
    // unverifiable install is the thing this command must not report as done.
    const families = readFontFamilies(candidate);
    if (families.length === 0) {
      return refuse(
        "supported",
        platform,
        fontDir,
        `"${candidate}" has a font extension but no readable family name in its sfnt \`name\` table, so NIGHTSHIFT cannot confirm installing it would work.`,
      );
    }
    // Defence in depth: the name is already a basename, but `security/paths.ts` is this
    // project's only sanctioned way to turn a name into a path under a directory.
    const destination = resolveSafePath(fontDir, path.basename(candidate));
    files.push({
      source: candidate,
      destination,
      families,
      replaces: fs.existsSync(destination),
    });
  }

  const families = [...new Set(files.flatMap((file) => file.families))].sort((a, b) =>
    a.localeCompare(b),
  );
  return { platform, support: "supported", fontDir, files, families, problem: null };
}

/**
 * Re-runs the existing detector for each family. Separate and exported because this is the step
 * that decides whether the command may claim anything at all, and it has to be assertable on its
 * own - including the case where a file was copied and the family still is not found.
 */
export function verifyFontFamilies(families: string[]): FontInstallResult["verified"] {
  return families.map((family) => ({
    family,
    found: findInstalledFont(family).match !== undefined,
  }));
}

/**
 * Performs an approved plan: copies each file into the per-user font directory, then verifies by
 * re-running detection rather than by assuming the copy was enough.
 *
 * Each copy is a read plus `atomicWriteFileSync`, so a font directory can never contain a
 * half-written file that the detector would then skip as corrupt.
 */
export function executeFontInstall(plan: FontInstallPlan): FontInstallResult {
  const copied: FontInstallFile[] = [];
  const failed: FontInstallResult["failed"] = [];

  for (const file of plan.files) {
    try {
      assertNotSymlink(file.destination);
      atomicWriteFileSync(file.destination, fs.readFileSync(file.source));
      copied.push(file);
    } catch (error) {
      failed.push({ source: file.source, message: (error as Error).message });
    }
  }

  return { copied, failed, verified: verifyFontFamilies(plan.families) };
}
