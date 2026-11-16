import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runShellInit, runShellRemove, runShellStatus } from "../../src/cli/commands/shell.js";
import {
  buildShellIntegrationPlan,
  executeShellIntegration,
  findManagedBlock,
  BLOCK_START,
  BLOCK_END,
} from "../../src/core/shell/integrate.js";
import { detectShell, detectStarship, profilePathFor } from "../../src/core/shell/detect.js";
import { initializeConfig, setActiveTheme } from "../../src/core/config/store.js";
import { listBackups } from "../../src/backup/manager.js";

/**
 * `nightshift shell`, the highest blast radius feature in the product: a corrupt `$PROFILE` can
 * leave a user without a working shell.
 *
 * Every test here repoints `USERPROFILE`, `OneDrive`, `APPDATA`, `PSModulePath`, `PATH` and
 * `STARSHIP_CONFIG` at a temporary directory, so the real `$PROFILE` is never a candidate - a
 * test that got the environment wrong would edit the developer's own shell startup file, which
 * is exactly the damage this feature has to be trusted not to do. `OneDrive` is *deleted* rather
 * than overwritten, because a real OneDrive-redirected Documents folder would otherwise win the
 * candidate search and point the write back at the real machine.
 *
 * The non-writing path is additionally proven against the real built binary, because "writes
 * nothing" is a claim about a process, not about a function.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.resolve(__dirname, "../../dist/index.js");

const ENV_KEYS = [
  "USERPROFILE",
  "OneDrive",
  "OneDriveConsumer",
  "APPDATA",
  "XDG_CONFIG_HOME",
  "PSModulePath",
  "PATH",
  "Path",
  "SHELL",
  "STARSHIP_CONFIG",
] as const;

describe("nightshift shell", () => {
  let tmpRoot: string;
  let home: string;
  let appData: string;
  let profileDir: string;
  let profilePath: string;
  let binDir: string;
  let saved: Map<string, string | undefined>;
  let out: string[];

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-shell-"));
    home = path.join(tmpRoot, "home");
    appData = path.join(tmpRoot, "AppData");
    profileDir = path.join(home, "Documents", "PowerShell");
    profilePath = path.join(profileDir, "Microsoft.PowerShell_profile.ps1");
    binDir = path.join(tmpRoot, "bin");
    fs.mkdirSync(binDir, { recursive: true });

    saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
    delete process.env.OneDrive;
    delete process.env.OneDriveConsumer;
    delete process.env.SHELL;
    process.env.USERPROFILE = home;
    process.env.APPDATA = appData;
    process.env.XDG_CONFIG_HOME = appData;
    // Claims a PowerShell 7 session, which is what the detector reads to pick an edition.
    process.env.PSModulePath = "C:\\Program Files\\PowerShell\\7\\Modules";
    // An empty directory, so `starship` is deliberately NOT found unless a test plants it.
    process.env.PATH = binDir;
    process.env.Path = binDir;
    process.env.STARSHIP_CONFIG = path.join(tmpRoot, "starship.toml");

    initializeConfig();
    setActiveTheme("ghost-protocol");

    out = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      out.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.exitCode = 0;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeProfile(content: string): void {
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(profilePath, content);
  }

  it("builds a plan that names the file it would write, and writes nothing building it", () => {
    writeProfile("Set-Alias ll Get-ChildItem\r\n");
    const plan = buildShellIntegrationPlan("init");

    expect(plan.problem).toBeNull();
    expect(plan.shell).toBe("pwsh");
    expect(plan.target?.path).toBe(profilePath);
    expect(plan.action).toBe("add");
    expect(plan.addedLines[0]).toBe(BLOCK_START);
    expect(plan.addedLines.at(-1)).toBe(BLOCK_END);
    expect(plan.addedLines).toContain('$env:NIGHTSHIFT_THEME = "ghost-protocol"');

    // Building the plan read the file and changed nothing about it.
    expect(fs.readFileSync(profilePath, "utf8")).toBe("Set-Alias ll Get-ChildItem\r\n");
  });

  it("prints the exact diff and writes NOTHING without a TTY and without --yes", async () => {
    writeProfile("Set-Alias ll Get-ChildItem\r\n");
    // vitest workers have no TTY on stdin/stdout, which is the condition under test.
    expect(process.stdin.isTTY).toBeFalsy();

    await runShellInit({});

    const text = out.join("\n");
    expect(text).toContain("Shell integration proposal");
    expect(text).toContain(profilePath);
    expect(text).toContain(`+ ${BLOCK_START}`);
    expect(text).toContain(`+ ${BLOCK_END}`);
    expect(text).toContain("Nothing has been written");
    expect(text).toContain("--yes");
    // The proof: the file is byte-identical and no backup was taken either.
    expect(fs.readFileSync(profilePath, "utf8")).toBe("Set-Alias ll Get-ChildItem\r\n");
    expect(listBackups()).toHaveLength(0);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("with --yes: backs up, adds the block, and leaves the user's own content untouched", async () => {
    const original = "# my profile\r\nSet-Alias ll Get-ChildItem\r\n";
    writeProfile(original);

    await runShellInit({ yes: true });

    const written = fs.readFileSync(profilePath, "utf8");
    expect(written.startsWith(original)).toBe(true);
    expect(written).toContain(BLOCK_START);
    expect(written).toContain('$env:NIGHTSHIFT_THEME = "ghost-protocol"');
    expect(written.endsWith(`${BLOCK_END}\r\n`)).toBe(true);
    // Step 1 of the proposal promised a backup first; this is that promise being kept.
    expect(listBackups()).toHaveLength(1);
    expect(out.join("\n")).toContain("Added NIGHTSHIFT's managed block");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("is idempotent: running it twice leaves a byte-identical file", async () => {
    writeProfile("Set-Alias ll Get-ChildItem\r\n");

    await runShellInit({ yes: true });
    const first = fs.readFileSync(profilePath);

    // The second run has nothing to change, so it reports that and writes nothing - and the
    // bytes are compared rather than the text, because "no second block was appended" is a
    // claim about the file, not about what the command said.
    await runShellInit({ yes: true });
    expect(fs.readFileSync(profilePath).equals(first)).toBe(true);
    expect(out.join("\n")).toContain("Nothing to change");
    expect(first.toString("utf8").match(new RegExp(BLOCK_START, "g"))).toHaveLength(1);
  });

  it("replaces an older version's block contents instead of appending a second one", async () => {
    const original = `# mine\r\n${BLOCK_START}\r\n# something an older NIGHTSHIFT wrote\r\n${BLOCK_END}\r\n# after mine\r\n`;
    writeProfile(original);

    const plan = buildShellIntegrationPlan("init");
    expect(plan.action).toBe("replace");
    expect(plan.removedLines).toContain("# something an older NIGHTSHIFT wrote");

    await runShellInit({ yes: true });

    const written = fs.readFileSync(profilePath, "utf8");
    expect(written.match(new RegExp(BLOCK_START, "g"))).toHaveLength(1);
    expect(written).not.toContain("something an older NIGHTSHIFT wrote");
    // The user's own lines on both sides of the block survived, in place.
    expect(written.startsWith("# mine\r\n")).toBe(true);
    expect(written.endsWith("# after mine\r\n")).toBe(true);
    expect(out.join("\n")).toContain("Updated NIGHTSHIFT's managed block");
  });

  it("removal restores the original bytes exactly, including content after the block", async () => {
    const original = "# mine\r\n$x = 1\r\n\r\n# trailing comment\r\n";
    writeProfile(original);
    const before = fs.readFileSync(profilePath);

    await runShellInit({ yes: true });
    expect(fs.readFileSync(profilePath, "utf8")).not.toBe(original);

    await runShellRemove({ yes: true });

    expect(fs.readFileSync(profilePath).equals(before)).toBe(true);
    expect(out.join("\n")).toContain("Removed NIGHTSHIFT's managed block");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("removal of a block in the middle of the file leaves both halves byte-identical", async () => {
    // The harder removal case: the block is not at the end, so getting the slice boundaries
    // wrong would eat a line of the user's own content on one side of it.
    const original = `before-1\r\nbefore-2\r\n${BLOCK_START}\r\n$env:NIGHTSHIFT_THEME = "old"\r\n${BLOCK_END}\r\nafter-1\r\nafter-2\r\n`;
    writeProfile(original);

    await runShellRemove({ yes: true });

    expect(fs.readFileSync(profilePath, "utf8")).toBe(
      "before-1\r\nbefore-2\r\nafter-1\r\nafter-2\r\n",
    );
  });

  it("creates a missing profile, and its parent directory, containing only the managed block", async () => {
    expect(fs.existsSync(profileDir)).toBe(false);

    const plan = buildShellIntegrationPlan("init");
    expect(plan.target?.exists).toBe(false);
    expect(plan.target?.dirExists).toBe(false);
    // Planning must not have created the directory it says it would create.
    expect(fs.existsSync(profileDir)).toBe(false);

    await runShellInit({ yes: true });

    const written = fs.readFileSync(profilePath, "utf8");
    expect(written).toBe(`${plan.addedLines.join("\r\n")}\r\n`);
    expect(written.startsWith(BLOCK_START)).toBe(true);
    expect(out.join("\n")).toContain("Added NIGHTSHIFT's managed block");
  });

  it("follows a symlinked profile instead of replacing it (#27)", async () => {
    const tracked = path.join(tmpRoot, "dotfiles-profile.ps1");
    fs.writeFileSync(tracked, "# tracked in a dotfiles repo\r\n");
    fs.mkdirSync(profileDir, { recursive: true });
    try {
      fs.symlinkSync(tracked, profilePath, "file");
    } catch {
      // A file symlink on Windows needs Developer Mode or elevation.
      return;
    }
    const realTracked = fs.realpathSync(tracked);

    const plan = buildShellIntegrationPlan("init");
    expect(plan.target?.path).toBe(realTracked);
    expect(plan.target?.linkPath).toBe(profilePath);
    // The proposal is the consent, so it names the file that is really written *and* the link.
    out = [];
    await runShellInit({});
    expect(out.join("\n")).toContain(realTracked);
    expect(out.join("\n")).toContain(profilePath);

    await runShellInit({ yes: true });

    expect(fs.lstatSync(profilePath).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(tracked, "utf8")).toContain(BLOCK_START);
    expect(fs.readFileSync(tracked, "utf8").startsWith("# tracked in a dotfiles repo\r\n")).toBe(
      true,
    );
  });

  it("preserves an LF-only profile's line endings rather than mixing in CRLF", async () => {
    writeProfile("# unix-style\n");

    await runShellInit({ yes: true });

    const written = fs.readFileSync(profilePath, "utf8");
    expect(written).not.toContain("\r");
    expect(written).toContain(`${BLOCK_START}\n`);
  });

  it("reports nothing to remove, rather than failing, when there is no block", async () => {
    writeProfile("# mine\r\n");

    await runShellRemove({ yes: true });

    expect(out.join("\n")).toContain("Nothing to remove");
    expect(fs.readFileSync(profilePath, "utf8")).toBe("# mine\r\n");
    // Idempotent removal must not exit non-zero on the second run.
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("refuses a profile containing two managed blocks rather than guessing", async () => {
    writeProfile(`${BLOCK_START}\r\n${BLOCK_END}\r\n${BLOCK_START}\r\n${BLOCK_END}\r\n`);

    await runShellInit({ yes: true });

    const text = out.join("\n");
    expect(text).toContain("cannot tell which block is its own");
    expect(process.exitCode).toBe(1);
  });

  it("refuses a profile whose managed block is never closed", async () => {
    const original = `# mine\r\n${BLOCK_START}\r\n$x = 1\r\n`;
    writeProfile(original);

    await runShellInit({ yes: true });

    expect(out.join("\n")).toContain("not a matched pair");
    expect(fs.readFileSync(profilePath, "utf8")).toBe(original);
    expect(process.exitCode).toBe(1);
  });

  it("refuses a profile larger than the shell-profile size cap", () => {
    writeProfile("#".repeat(1024 * 1024 + 1));
    const plan = buildShellIntegrationPlan("init");
    expect(plan.problem).toContain("exceeds the");
  });

  it("refuses an active theme id that is not a valid id, because it reaches PowerShell source", () => {
    // `activeThemeId` is a plain string field in a hand-editable config.json, and the block it
    // lands in is executed by the user's shell on every start. "The theme schema validates it"
    // is not a property of the file on disk.
    fs.writeFileSync(
      path.join(appData, "nightshift", "config.json"),
      JSON.stringify({
        schemaVersion: "1.0",
        activeThemeId: '"; Remove-Item -Recurse C:\\ #',
        activeProfileId: null,
        initializedAt: new Date().toISOString(),
      }),
    );

    const plan = buildShellIntegrationPlan("init");
    expect(plan.problem).toContain("Refusing to write it");
    expect(plan.nextText).toBe("");
  });

  it("refuses to write an empty block when there is no theme and no starship", () => {
    fs.writeFileSync(
      path.join(appData, "nightshift", "config.json"),
      JSON.stringify({
        schemaVersion: "1.0",
        activeThemeId: null,
        activeProfileId: null,
        initializedAt: new Date().toISOString(),
      }),
    );

    const plan = buildShellIntegrationPlan("init");
    expect(plan.problem).toContain("nothing for the managed block to contain");
  });

  it("adds a guarded Starship init line only when the binary is on PATH", async () => {
    const withoutStarship = buildShellIntegrationPlan("init");
    expect(withoutStarship.addedLines.join("\n")).not.toContain("starship");

    fs.writeFileSync(path.join(binDir, "starship.exe"), "");
    const withStarship = buildShellIntegrationPlan("init");
    expect(withStarship.starship.binary).toBe(path.join(binDir, "starship.exe"));
    // Guarded, so uninstalling Starship later degrades to doing nothing instead of printing an
    // error on every new shell.
    expect(withStarship.addedLines).toContain(
      "if (Get-Command starship -ErrorAction SilentlyContinue) {",
    );
    expect(withStarship.addedLines).toContain("  Invoke-Expression (&starship init powershell)");

    await runShellInit({ yes: true });
    expect(fs.readFileSync(profilePath, "utf8")).toContain("starship init powershell");
    // The half that was not built says so, before approval.
    expect(out.join("\n")).toContain("not performed");
  });

  it("reports the Starship config it looked for without reading or writing it", () => {
    const configPath = path.join(tmpRoot, "starship.toml");
    expect(detectStarship().configPath).toBe(configPath);
    expect(detectStarship().configExists).toBe(false);
    fs.writeFileSync(configPath, "# user's own\n");
    expect(detectStarship().configExists).toBe(true);
    // Never parsed, never rewritten: generating a starship.toml is not implemented.
    expect(fs.readFileSync(configPath, "utf8")).toBe("# user's own\n");
  });

  it("restores the profile from its backup when the write cannot be verified", () => {
    const original = "# mine\r\n";
    writeProfile(original);
    const plan = buildShellIntegrationPlan("init");

    // The verification read is faked once, so the engine sees content that is not what it
    // wrote. This is the rollback path: the thing that has to work when nothing else did.
    const readFileSync = vi.spyOn(fs, "readFileSync");
    readFileSync.mockImplementationOnce(() => "tampered");

    const result = executeShellIntegration(plan);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("restored it");
    readFileSync.mockRestore();
    expect(fs.readFileSync(profilePath, "utf8")).toBe(original);
  });

  it("deletes a profile it created when the write cannot be verified", () => {
    // There is no snapshot to restore when the file never existed, so the undo is a delete -
    // leaving a half-approved block behind would be worse than leaving nothing.
    const plan = buildShellIntegrationPlan("init");
    const readFileSync = vi.spyOn(fs, "readFileSync");
    readFileSync.mockImplementationOnce(() => "tampered");

    const result = executeShellIntegration(plan);

    expect(result.ok).toBe(false);
    readFileSync.mockRestore();
    expect(fs.existsSync(profilePath)).toBe(false);
  });

  it("refuses, before any write, when the profile path is not a readable file", async () => {
    // A directory where the profile should be. The plan refuses while reading, so the write is
    // never attempted at all - the failure happens in the half that cannot write by design.
    fs.mkdirSync(profilePath, { recursive: true });

    await runShellInit({ yes: true });

    expect(out.join("\n")).toContain("Could not read");
    expect(fs.statSync(profilePath).isDirectory()).toBe(true);
    expect(listBackups()).toHaveLength(0);
    expect(process.exitCode).toBe(1);
  });

  it("reports a failed backup without editing the profile", () => {
    // The backup is step 1 of the proposal, so if it cannot be taken the edit must not happen:
    // an edit with no snapshot behind it is the one thing this feature must never do. The file
    // is swapped for a directory *after* planning, so execution reaches `createBackup` and
    // fails there rather than during the read.
    writeProfile("# mine\r\n");
    const plan = buildShellIntegrationPlan("init");
    fs.rmSync(profilePath);
    fs.mkdirSync(profilePath);

    const result = executeShellIntegration(plan);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Failed to create a backup");
    expect(fs.statSync(profilePath).isDirectory()).toBe(true);
  });

  it("`shell status` reports every detected fact and both unbuilt halves", () => {
    writeProfile(`# mine\r\n${BLOCK_START}\r\n${BLOCK_END}\r\n`);
    process.env.SHELL = "/bin/bash";

    runShellStatus();

    const text = out.join("\n");
    expect(text).toContain("PowerShell 7+");
    // The table truncates a long path to the terminal's width, so the assertion is on the part
    // that proves it is the temporary profile and not the developer's real one.
    expect(text).toContain(home);
    expect(text).toContain("present");
    expect(text).toContain("SHELL=/bin/bash");
    expect(text).toContain("bash and zsh startup files are not implemented");
    expect(text).toContain("does not generate or edit starship.toml");
  });

  describe("shell detection", () => {
    it("identifies Windows PowerShell 5.1 from PSModulePath", () => {
      process.env.PSModulePath = "C:\\Windows\\system32\\WindowsPowerShell\\v1.0\\Modules";
      const detection = detectShell();
      expect(detection.shell).toBe("powershell");
      expect(detection.support).toBe("supported");
      expect(profilePathFor("powershell")).toBe(
        path.join(home, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
      );
    });

    it("falls back to an existing profile file when PSModulePath says nothing", () => {
      process.env.PSModulePath = "";
      expect(detectShell().shell).toBeNull();
      expect(detectShell().support).toBe("unknown");

      writeProfile("# mine\r\n");
      const detection = detectShell();
      expect(detection.shell).toBe("pwsh");
      expect(detection.evidence).toContain("already has a profile file");
    });

    it("prefers OneDrive's Documents when that is where Documents lives", () => {
      // OneDrive's Known Folder Move is the default on a lot of consumer Windows 11 installs.
      // Writing %USERPROFILE%\Documents there creates a profile no shell ever loads.
      const oneDrive = path.join(tmpRoot, "OneDrive");
      fs.mkdirSync(path.join(oneDrive, "Documents", "PowerShell"), { recursive: true });
      process.env.OneDrive = oneDrive;

      expect(profilePathFor("pwsh")).toBe(
        path.join(oneDrive, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
      );
    });

    it("refuses when there is no Documents directory to put a profile in", () => {
      // A stripped environment (a service account, a container) with no USERPROFILE at all.
      // There is no path to propose, so the command refuses rather than inventing one.
      process.env.USERPROFILE = "";
      expect(profilePathFor("pwsh")).toBeNull();
      expect(detectShell().support).toBe("unknown");
      expect(buildShellIntegrationPlan("init").problem).toContain("No Documents directory");
    });

    it("finds the managed block in a file whose markers use CRLF", () => {
      const scan = findManagedBlock(`a\r\n${BLOCK_START}\r\nx\r\n${BLOCK_END}\r\nb\r\n`);
      expect(scan.kind).toBe("found");
    });

    it("does not treat a marker embedded in a longer line as its own block", () => {
      const scan = findManagedBlock(`echo "${BLOCK_START} not really"\r\n`);
      expect(scan.kind).toBe("absent");
    });
  });

  it("reports unsupported, and writes nothing, on a platform that is not win32", async () => {
    vi.resetModules();
    vi.doMock("node:os", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:os")>();
      const patched = { ...actual, platform: () => "linux" as const };
      return { ...patched, default: patched };
    });
    try {
      const shell = await import("../../src/core/shell/integrate.js");
      const plan = shell.buildShellIntegrationPlan("init");

      // Asserted first: if the mock were not applied every assertion below would pass for the
      // wrong reason.
      expect(plan.platform).toBe("linux");
      expect(plan.support).toBe("unsupported");
      expect(plan.problem).toContain("not implemented on linux");
      expect(plan.target).toBeNull();

      const cli = await import("../../src/cli/commands/shell.js");
      await cli.runShellInit({ yes: true });
      expect(fs.existsSync(profilePath)).toBe(false);
      expect(process.exitCode).toBe(1);
    } finally {
      vi.doUnmock("node:os");
      vi.resetModules();
    }
  });
});

describe("nightshift shell (built dist/index.js, non-interactive)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-shell-cli-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("prints the diff, writes nothing, exits 0, and does not hang on non-TTY stdin", () => {
    const home = path.join(tmpRoot, "home");
    const appData = path.join(tmpRoot, "AppData");
    const profilePath = path.join(
      home,
      "Documents",
      "PowerShell",
      "Microsoft.PowerShell_profile.ps1",
    );
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });
    fs.writeFileSync(profilePath, "Set-Alias ll Get-ChildItem\r\n");
    // An active theme, so the block has something to contain. Written as a file rather than via
    // the store, because this test's subject is a separate process reading this directory.
    fs.mkdirSync(path.join(appData, "nightshift"), { recursive: true });
    fs.writeFileSync(
      path.join(appData, "nightshift", "config.json"),
      JSON.stringify({
        schemaVersion: "1.0",
        activeThemeId: "ghost-protocol",
        activeProfileId: null,
        initializedAt: new Date().toISOString(),
      }),
    );

    const env = {
      ...process.env,
      USERPROFILE: home,
      APPDATA: appData,
      XDG_CONFIG_HOME: appData,
      PSModulePath: "C:\\Program Files\\PowerShell\\7\\Modules",
      PATH: path.join(tmpRoot, "bin"),
      Path: path.join(tmpRoot, "bin"),
      STARSHIP_CONFIG: path.join(tmpRoot, "starship.toml"),
      OneDrive: undefined,
      OneDriveConsumer: undefined,
    };

    const start = Date.now();
    // `input: ""` gives the child a pipe for stdin rather than a TTY. A clack prompt reached
    // here would wait for a line that never arrives - the hang this guard exists to prevent,
    // which is why the timeout is part of the assertion and not just a safety net.
    const stdout = execFileSync(process.execPath, [cliEntry, "shell", "init"], {
      encoding: "utf8",
      input: "",
      timeout: 15000,
      env,
    });

    expect(Date.now() - start).toBeLessThan(15000);
    expect(stdout).toContain("Shell integration proposal");
    expect(stdout).toContain("Nothing has been written");
    // The proof: the real process left the profile byte-identical.
    expect(fs.readFileSync(profilePath, "utf8")).toBe("Set-Alias ll Get-ChildItem\r\n");
  });
});
