import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSafePath } from "../../security/paths.js";
// Type-only, as in fonts/detect.ts: erased at compile time, so shell detection does not pull
// the capability detector (and zod behind it) onto this path.
import type { SupportLevel } from "../capabilities/detect.js";

/**
 * Which shell, and which startup file.
 *
 * Everything here is read-only. It answers three questions and refuses to guess at any of them:
 * which shell is running, where that shell's startup file really is, and whether Starship is
 * present.
 *
 * **No child process.** `docs/SECURITY-MODEL.md` states there is no child-process execution
 * anywhere in `src/`, and that claim is load bearing - this feature writes a file that the
 * user's shell *executes* on every start, so it is the last place to start spawning things.
 * That rules out the two obvious implementations: asking PowerShell for `$PROFILE`, and running
 * `starship --version`. Both are replaced by filesystem evidence below.
 *
 * **PowerShell only, deliberately** - the same decision `completion` records (#19). Windows is
 * the only supported platform (`docs/PLATFORM-COMPATIBILITY.md`), and a `.bashrc`/`.zshrc`
 * writer that nobody can test on this machine would be a startup file corrupted on a platform
 * the product does not claim. A detected bash or zsh is *reported* rather than written to.
 */

/** The two PowerShell editions, which have different profile paths and are not interchangeable. */
export const SHELL_IDS = ["pwsh", "powershell"] as const;
export type ShellId = (typeof SHELL_IDS)[number];

export const SHELL_LABELS: Record<ShellId, string> = {
  pwsh: "PowerShell 7+ (pwsh)",
  powershell: "Windows PowerShell 5.1 (powershell)",
};

/** The `Documents` subdirectory each edition keeps its profile in. */
const PROFILE_SUBPATH: Record<ShellId, string> = {
  pwsh: "PowerShell/Microsoft.PowerShell_profile.ps1",
  powershell: "WindowsPowerShell/Microsoft.PowerShell_profile.ps1",
};

/** A located startup file, resolved through any symlink the user put in the way. */
export interface ShellProfileTarget {
  shell: ShellId;
  /** The real file to read, back up and write. */
  path: string;
  /** The symlink `path` was reached through, or null when the located path was not a link. */
  linkPath: string | null;
  exists: boolean;
  /** The directory `path` lives in - named in the proposal, because it may be created. */
  dir: string;
  dirExists: boolean;
}

export interface ShellDetection {
  /** `supported` on Windows with a PowerShell profile path, `unknown` on Windows without a
   * home directory, `unsupported` everywhere else. Deliberately not a silent null: "no shell
   * found" and "this platform was never looked at" are different claims. */
  support: SupportLevel;
  platform: NodeJS.Platform;
  shell: ShellId | null;
  /** What named the shell, printed verbatim so the user can disagree with it. */
  evidence: string;
  /** A non-PowerShell shell this environment advertises, reported and never written to. */
  otherShell: string | null;
}

/**
 * Where `Documents` really is.
 *
 * `$PROFILE` is under the user's `Documents` folder, and OneDrive's Known Folder Move relocates
 * that to `%OneDrive%\Documents` - which is the default on a lot of consumer Windows 11
 * installs, not an exotic case. Writing `%USERPROFILE%\Documents` there creates a second,
 * never-loaded profile and the integration silently does nothing. So both are candidates and
 * the one that exists wins, preferring a directory that already holds a profile.
 */
function documentsCandidates(): string[] {
  const home = process.env.USERPROFILE ?? os.homedir();
  const candidates: string[] = [];
  for (const root of [process.env.OneDrive, process.env.OneDriveConsumer, home]) {
    if (!root) continue;
    const dir = path.join(root, "Documents");
    if (!candidates.includes(dir)) candidates.push(dir);
  }
  return candidates;
}

/**
 * The `$PROFILE` path for one edition, or null when there is no home directory to put it in.
 *
 * Built with `resolveSafePath` under the `Documents` directory rather than `path.join`: the
 * segment is a constant here, but `security/paths.ts` is this project's only sanctioned way to
 * turn a name into a path under a directory, and an inherited `OneDrive` env var is still an
 * environment-supplied base.
 */
export function profilePathFor(shell: ShellId): string | null {
  const candidates = documentsCandidates();
  if (candidates.length === 0) return null;

  const paths = candidates.map((dir) => resolveSafePath(dir, PROFILE_SUBPATH[shell]));
  // An existing profile is the strongest possible evidence of where this shell really loads
  // from, so it beats directory existence, which beats the first candidate.
  return (
    paths.find((candidate) => fs.existsSync(candidate)) ??
    paths.find((candidate) => fs.existsSync(path.dirname(candidate))) ??
    paths[0] ??
    null
  );
}

/**
 * Follows a symlinked startup file to the file that must actually be written.
 *
 * Same reasoning as `resolveSettingsTarget` for Windows Terminal's settings.json (#27):
 * `atomicWriteFileSync` *renames over* its target, which replaces a link instead of the file it
 * points at - and a `$PROFILE` symlinked into a dotfiles repository is the single most likely
 * setup among the people who would run this command. The link is honoured rather than refused,
 * because it is a deliberate instruction meaning "this file lives elsewhere".
 *
 * Not shared with `resolveSettingsTarget`: that function's failure message names Windows
 * Terminal's settings.json and tells the user to let Windows Terminal recreate it, which is the
 * wrong instruction for a shell profile. The behaviour is six lines; the message is the part
 * that has to be right.
 */
export function resolveShellProfile(shell: ShellId, located: string): ShellProfileTarget {
  let real = located;
  let linkPath: string | null = null;
  try {
    if (fs.lstatSync(located).isSymbolicLink()) {
      // realpathSync throws on a dangling link. That is reported as "does not exist" by the
      // caller rather than thrown here: a broken $PROFILE symlink is a thing `shell status`
      // must stay able to describe.
      real = fs.realpathSync(located);
      linkPath = located;
    }
  } catch {
    // Either it does not exist yet (the common case - nothing to follow) or the link dangles.
  }

  return {
    shell,
    path: real,
    linkPath,
    exists: fs.existsSync(real),
    dir: path.dirname(real),
    dirExists: fs.existsSync(path.dirname(real)),
  };
}

/** Names the file that is really written, and the link it was reached through when they differ. */
export function describeShellProfile(target: ShellProfileTarget): string {
  return target.linkPath ? `${target.path} (via the symlink ${target.linkPath})` : target.path;
}

/**
 * Which shell this is, from evidence rather than assumption.
 *
 * `PSModulePath` is inherited by every child process PowerShell starts, so it is present in
 * this Node process whenever a PowerShell started it, and its contents distinguish the two
 * editions: PowerShell 7 puts its own `...\PowerShell\7\Modules` on the path, Windows
 * PowerShell 5.1 only ever has `...\WindowsPowerShell\v1.0\Modules`. When there is no such
 * evidence (started from cmd.exe, an IDE, a scheduled task) an existing profile file is the
 * fallback, and when there is neither, this reports `null` rather than picking one - writing
 * the wrong edition's profile produces a file no shell ever loads.
 */
export function detectShell(): ShellDetection {
  const platform = os.platform();
  const otherShell = process.env.SHELL ?? null;

  if (platform !== "win32") {
    return {
      support: "unsupported",
      platform,
      shell: null,
      evidence: `platform is ${platform}; NIGHTSHIFT only writes PowerShell profiles`,
      otherShell,
    };
  }

  const psModulePath = process.env.PSModulePath ?? "";
  const normalized = psModulePath.toLowerCase().replace(/\//g, "\\");
  let shell: ShellId | null = null;
  let evidence: string;
  if (normalized.includes("\\powershell\\7\\modules")) {
    shell = "pwsh";
    evidence = "PSModulePath contains PowerShell\\7\\Modules";
  } else if (normalized.includes("windowspowershell")) {
    shell = "powershell";
    evidence = "PSModulePath contains WindowsPowerShell";
  } else {
    const existing = SHELL_IDS.find((id) => {
      const located = profilePathFor(id);
      return located !== null && fs.existsSync(located);
    });
    if (existing) {
      shell = existing;
      evidence = `no PSModulePath evidence; ${SHELL_LABELS[existing]} already has a profile file`;
    } else {
      evidence =
        "no PSModulePath evidence and no existing PowerShell profile file - the shell could not be identified";
    }
  }

  if (shell === null) {
    return { support: "unknown", platform, shell: null, evidence, otherShell };
  }
  if (profilePathFor(shell) === null) {
    return {
      support: "unknown",
      platform,
      shell,
      evidence: `${evidence}, but no Documents directory could be located`,
      otherShell,
    };
  }
  return { support: "supported", platform, shell, evidence, otherShell };
}

export interface StarshipDetection {
  /** The `starship` executable found on PATH, or null. */
  binary: string | null;
  /** Where `starship.toml` is expected, honouring `STARSHIP_CONFIG`. Null without a home. */
  configPath: string | null;
  configExists: boolean;
}

/**
 * Starship, found by looking for the binary on PATH with `fs` - never by running it.
 *
 * `starship --version` would be a child process, which this project does not have anywhere in
 * `src/`; a PATH scan answers the only question that matters here ("is it installed") with a
 * few `statSync` calls. The executable is never read or executed by NIGHTSHIFT: the result only
 * decides whether the managed block gets a Starship init line.
 */
export function detectStarship(): StarshipDetection {
  const extensions = os.platform() === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  let binary: string | null = null;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = path.join(dir, `starship${extension}`);
      try {
        if (fs.statSync(candidate).isFile()) {
          binary = candidate;
          break;
        }
      } catch {
        // Unreadable or absent PATH entry - the next one is not affected by it.
      }
    }
    if (binary) break;
  }

  const home = process.env.USERPROFILE ?? os.homedir();
  const configPath =
    process.env.STARSHIP_CONFIG ?? (home ? path.join(home, ".config", "starship.toml") : null);
  return { binary, configPath, configExists: configPath !== null && fs.existsSync(configPath) };
}
