import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSetup, buildSetupProposal, renderSetupProposal } from "../../src/cli/commands/setup.js";
import { readConfig } from "../../src/core/config/store.js";
import { listBackups } from "../../src/backup/manager.js";

/**
 * `nightshift setup`, driven two ways.
 *
 * The executing path (`--yes`) runs against a temporary LOCALAPPDATA containing a fake Windows
 * Terminal settings.json - the pattern from `theme-apply-engine.test.ts`. It is never run as a
 * live CLI command, because capability detection reads the real %LOCALAPPDATA% and would rewrite
 * the developer's actual terminal settings regardless of APPDATA.
 *
 * The non-writing path is additionally proven against the real built binary, because "writes
 * nothing" is a claim about a process, not about a function.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.resolve(__dirname, "../../dist/index.js");
const WT = ["Packages", "Microsoft.WindowsTerminal_8wekyb3d8bbwe", "LocalState"];

const ORIGINAL_SETTINGS = {
  defaultProfile: "{some-guid}",
  copyOnSelect: true,
  profiles: { defaults: { useAcrylic: true }, list: [{ name: "PowerShell" }] },
  schemes: [{ name: "Campbell", background: "#0C0C0C" }],
};

describe("nightshift setup", () => {
  let tmpRoot: string;
  let appData: string;
  let localAppData: string;
  let settingsPath: string;
  let configPath: string;
  let originalLocalAppData: string | undefined;
  let originalAppData: string | undefined;
  let originalXdg: string | undefined;
  let out: string[];

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-setup-"));
    localAppData = path.join(tmpRoot, "LocalAppData");
    appData = path.join(tmpRoot, "AppData");
    settingsPath = path.join(localAppData, ...WT, "settings.json");
    configPath = path.join(appData, "nightshift", "config.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(ORIGINAL_SETTINGS, null, 2));

    originalLocalAppData = process.env.LOCALAPPDATA;
    originalAppData = process.env.APPDATA;
    originalXdg = process.env.XDG_CONFIG_HOME;
    process.env.LOCALAPPDATA = localAppData;
    process.env.APPDATA = appData;
    process.env.XDG_CONFIG_HOME = appData;

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
    process.env.LOCALAPPDATA = originalLocalAppData;
    process.env.APPDATA = originalAppData;
    process.env.XDG_CONFIG_HOME = originalXdg;
    process.exitCode = 0;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("builds a proposal that names every path it would write, and writes nothing building it", () => {
    const proposal = buildSetupProposal();

    expect(proposal.configExists).toBe(false);
    expect(proposal.configRoot).toBe(path.join(appData, "nightshift"));
    expect(proposal.themeId).toBe("ghost-protocol");
    expect(proposal.themeName).toBe("Ghost Protocol");
    expect(proposal.settingsPath).toBe(settingsPath);

    const rendered = renderSetupProposal(proposal);
    expect(rendered).toContain(proposal.configRoot);
    expect(rendered).toContain(settingsPath);
    expect(rendered).toContain("Back up Windows Terminal's settings.json first");
    expect(rendered).toContain("Ghost Protocol");

    expect(fs.existsSync(path.join(appData, "nightshift"))).toBe(false);
  });

  it("names the resolved target, not the link, when settings.json is a symlink (#27)", async () => {
    // `setup` is the one command that writes outside NIGHTSHIFT's own directory, so its
    // proposal is the consent. Proposing the link path while writing the target would make the
    // approval cover a file the user was never shown - the same defect as severing the link,
    // in a different costume. This also proves `setup` inherits the engine fix rather than
    // carrying a second resolution of its own.
    const tracked = path.join(tmpRoot, "dotfiles-settings.json");
    fs.writeFileSync(tracked, JSON.stringify(ORIGINAL_SETTINGS, null, 2));
    fs.rmSync(settingsPath);
    try {
      fs.symlinkSync(tracked, settingsPath, "file");
    } catch {
      // A file symlink on Windows needs Developer Mode or elevation.
      return;
    }
    const realTracked = fs.realpathSync(tracked);

    const proposal = buildSetupProposal();
    expect(proposal.settingsPath).toBe(realTracked);
    const rendered = renderSetupProposal(proposal);
    expect(rendered).toContain(realTracked);
    expect(rendered).toContain(settingsPath);

    await runSetup({ yes: true });

    const text = out.join("\n");
    expect(text).toContain('Applied "Ghost Protocol" to Windows Terminal');
    expect(text).toContain(realTracked);
    expect(fs.lstatSync(settingsPath).isSymbolicLink()).toBe(true);
    expect(JSON.parse(fs.readFileSync(tracked, "utf8")).profiles.defaults.colorScheme).toBe(
      "Ghost Protocol",
    );
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("prints the proposal and writes NOTHING without a TTY and without --yes", async () => {
    // vitest workers have no TTY on stdin/stdout, which is the condition under test.
    expect(process.stdin.isTTY).toBeFalsy();
    const settingsBefore = fs.readFileSync(settingsPath, "utf8");

    await runSetup({});

    const text = out.join("\n");
    expect(text).toContain("Setup proposal");
    expect(text).toContain("Nothing has been written");
    expect(text).toContain("--yes");
    expect(fs.existsSync(path.join(appData, "nightshift"))).toBe(false);
    expect(fs.readFileSync(settingsPath, "utf8")).toBe(settingsBefore);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("with --yes: creates the config, backs up, and applies the default theme", async () => {
    await runSetup({ yes: true });

    const text = out.join("\n");
    expect(text).toContain("Setup proposal");
    expect(text).toContain("Created configuration directory");
    expect(text).toContain('Applied "Ghost Protocol" to Windows Terminal');
    expect(process.exitCode ?? 0).toBe(0);

    expect(readConfig().activeThemeId).toBe("ghost-protocol");

    const written = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(written.profiles.defaults.colorScheme).toBe("Ghost Protocol");
    // Unrelated keys survive, and the pre-existing scheme is added to rather than replaced.
    expect(written.copyOnSelect).toBe(true);
    expect(written.profiles.list).toEqual(ORIGINAL_SETTINGS.profiles.list);
    expect(written.schemes.map((s: { name: string }) => s.name)).toEqual([
      "Campbell",
      "Ghost Protocol",
    ]);
    // Step 2 of the proposal promised a backup first; this is that promise being kept.
    expect(listBackups().length).toBeGreaterThan(0);
  });

  it("with --yes and no Windows Terminal: configures, warns, and still succeeds", async () => {
    fs.rmSync(settingsPath);

    await runSetup({ yes: true });

    const text = out.join("\n");
    expect(text).toContain("Skip theme application");
    expect(text).toContain("Skipped applying");
    expect(fs.existsSync(configPath)).toBe(true);
    // The proposal said this step would be skipped, so skipping it is not a failure.
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("with --yes: exits non-zero and points at doctor when the apply fails", async () => {
    // The proposal promised step 3, so a failure here contradicts what the user approved and
    // must be a *failure*, unlike the "Windows Terminal is absent" case above, which the
    // proposal already told them would be skipped. This is the only branch of executeSetup
    // that sets a non-zero exit code and nothing had ever run it.
    //
    // The settings path is made a directory so the backup copy cannot succeed: the apply fails
    // before anything is read or written, which keeps the test about setup's handling rather
    // than about a half-finished write.
    fs.rmSync(settingsPath);
    fs.mkdirSync(settingsPath);

    await runSetup({ yes: true });

    const text = out.join("\n");
    // The config directory step ran and succeeded before the apply was attempted; setup does
    // not pretend it did not.
    expect(text).toContain("Created configuration directory");
    expect(fs.existsSync(configPath)).toBe(true);
    expect(text).toContain("Failed to create a backup before applying the theme");
    expect(text).toContain("Run `nightshift doctor`");
    expect(text).toContain("re-run `nightshift setup`");
    expect(process.exitCode).toBe(1);
    // No active theme was recorded, because none was applied.
    expect(readConfig().activeThemeId).toBeNull();
    expect(fs.statSync(settingsPath).isDirectory()).toBe(true);
  });

  it("proposes skipping the theme and names the platform when the host is not win32", async () => {
    // A real Windows Terminal settings.json is on disk and LOCALAPPDATA points at it, so a
    // proposal built from the filesystem rather than from the platform would offer to rewrite
    // it. On linux there is no Windows Terminal to rewrite and the proposal must say so.
    vi.resetModules();
    vi.doMock("node:os", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:os")>();
      const patched = { ...actual, platform: () => "linux" as const };
      return { ...patched, default: patched };
    });
    try {
      const setup = await import("../../src/cli/commands/setup.js");
      const proposal = setup.buildSetupProposal();

      // Asserted first: if the mock were not applied the module would report the real host and
      // every assertion below would pass for the wrong reason.
      expect(proposal.platform).toBe("linux");
      expect(proposal.settingsPath).toBeNull();

      const rendered = setup.renderSetupProposal(proposal);
      expect(rendered).toContain("Skip theme application");
      expect(rendered).toContain("platform: linux");
      expect(rendered).not.toContain(settingsPath);
      expect(rendered).toContain("no file outside the directory above would be modified");
    } finally {
      vi.doUnmock("node:os");
      vi.resetModules();
    }
  });

  it("reports an existing config as reused rather than created", async () => {
    await runSetup({ yes: true });
    out = [];

    await runSetup({ yes: true });
    const text = out.join("\n");
    expect(text).toContain("already exists");
    expect(text).toContain("Configuration directory in place");
    expect(text).not.toContain("Created configuration directory");
  });
});

describe("nightshift setup (built dist/index.js, non-interactive)", () => {
  let appData: string;

  beforeEach(() => {
    appData = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-setup-cli-"));
  });

  afterEach(() => {
    fs.rmSync(appData, { recursive: true, force: true });
  });

  it("prints the proposal, writes nothing, exits 0, and does not hang on non-TTY stdin", () => {
    const start = Date.now();
    // `input: ""` gives the child a pipe for stdin rather than a TTY. A clack prompt reached
    // here would wait for a line that never arrives - the hang this guard exists to prevent,
    // which is why the timeout is part of the assertion and not just a safety net.
    const stdout = execFileSync(process.execPath, [cliEntry, "setup"], {
      encoding: "utf8",
      input: "",
      timeout: 15000,
      env: { ...process.env, APPDATA: appData, XDG_CONFIG_HOME: appData },
    });

    expect(Date.now() - start).toBeLessThan(15000);
    expect(stdout).toContain("Setup proposal");
    expect(stdout).toContain("Nothing has been written");
    // The proof: the config root the proposal named does not exist after the run.
    expect(fs.existsSync(path.join(appData, "nightshift"))).toBe(false);
    expect(fs.readdirSync(appData)).toEqual([]);
  });
});
