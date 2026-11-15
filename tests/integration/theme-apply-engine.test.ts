import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  applyThemeFileOnly,
  applyThemeToWindowsTerminal,
  recordActiveState,
} from "../../src/core/themes/apply.js";
import { readConfig, tryReadConfig } from "../../src/core/config/store.js";
import { listBackups } from "../../src/backup/manager.js";

/**
 * Direct coverage of the theme-apply engine extracted out of `src/cli/commands/theme.ts`
 * (A-6). Before the move the engine was only reached through `applyProfile`, so the theme path
 * and the shared `recordActiveState` rollback had no test of their own - which is exactly what
 * made moving the code that rewrites the user's Windows Terminal settings risky.
 *
 * Everything here runs against a temporary LOCALAPPDATA/APPDATA, never the real one.
 */

const WT = ["Packages", "Microsoft.WindowsTerminal_8wekyb3d8bbwe", "LocalState"];

const ORIGINAL_SETTINGS = {
  $help: "https://aka.ms/terminal-documentation",
  defaultProfile: "{some-guid}",
  copyOnSelect: true,
  profiles: { defaults: { useAcrylic: true }, list: [{ name: "PowerShell" }] },
  schemes: [{ name: "Campbell", background: "#0C0C0C" }],
};

describe("theme apply engine", () => {
  let tmpRoot: string;
  let appData: string;
  let settingsPath: string;
  let originalLocalAppData: string | undefined;
  let originalAppData: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-theme-engine-"));
    const localAppData = path.join(tmpRoot, "LocalAppData");
    appData = path.join(tmpRoot, "AppData");
    settingsPath = path.join(localAppData, ...WT, "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(ORIGINAL_SETTINGS, null, 2));

    originalLocalAppData = process.env.LOCALAPPDATA;
    originalAppData = process.env.APPDATA;
    process.env.LOCALAPPDATA = localAppData;
    process.env.APPDATA = appData;
  });

  afterEach(() => {
    process.env.LOCALAPPDATA = originalLocalAppData;
    process.env.APPDATA = originalAppData;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("applies a theme, preserves unrelated settings, and records it as active", () => {
    const result = applyThemeToWindowsTerminal("ghost-protocol");

    expect(result.ok).toBe(true);
    expect(result.backupId).toBeDefined();
    expect(result.message).toContain('Applied "Ghost Protocol" to Windows Terminal');
    expect(result.message).toContain(`Backup id: ${result.backupId}.`);

    const written = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(written.$help).toBe(ORIGINAL_SETTINGS.$help);
    expect(written.defaultProfile).toBe(ORIGINAL_SETTINGS.defaultProfile);
    expect(written.copyOnSelect).toBe(true);
    expect(written.profiles.defaults.useAcrylic).toBe(true);
    expect(written.profiles.defaults.colorScheme).toBe("Ghost Protocol");
    expect(written.profiles.list).toEqual(ORIGINAL_SETTINGS.profiles.list);
    // The pre-existing scheme survives; the new one is added, not substituted.
    expect(written.schemes.map((s: { name: string }) => s.name)).toEqual([
      "Campbell",
      "Ghost Protocol",
    ]);

    const config = readConfig();
    expect(config.activeThemeId).toBe("ghost-protocol");
    expect(config.activeProfileId).toBeNull();
    expect(listBackups().length).toBeGreaterThan(0);
  });

  it("fails without touching settings or config for an unknown theme id", () => {
    const before = fs.readFileSync(settingsPath, "utf8");
    const result = applyThemeFileOnly("does-not-exist");

    expect(result).toEqual({ ok: false, message: 'No theme found with id "does-not-exist".' });
    expect(fs.readFileSync(settingsPath, "utf8")).toBe(before);
    expect(fs.existsSync(path.join(appData, "nightshift", "config.json"))).toBe(false);
  });

  it("reports a missing Windows Terminal settings.json instead of throwing", () => {
    fs.rmSync(settingsPath);
    const result = applyThemeToWindowsTerminal("ghost-protocol");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Windows Terminal settings.json was not found");
  });

  it("applyThemeFileOnly writes the terminal but never NIGHTSHIFT's config", () => {
    const result = applyThemeFileOnly("monolith");

    expect(result.ok).toBe(true);
    expect(result.message).not.toContain("Backup id");
    const written = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(written.profiles.defaults.colorScheme).toBe("Monolith");
    // This is the whole reason the function exists separately: no active-state side effect.
    expect(fs.existsSync(path.join(appData, "nightshift", "config.json"))).toBe(false);
  });

  it("restores the terminal backup when recording active state fails", () => {
    // Force the config write to fail without breaking backups: pre-create config.json as a
    // directory, so reading/writing it as a file throws EISDIR while the sibling backups/
    // directory under the same root still works.
    fs.mkdirSync(path.join(appData, "nightshift", "config.json"), { recursive: true });
    const before = fs.readFileSync(settingsPath, "utf8");

    const result = applyThemeToWindowsTerminal("ghost-protocol");

    expect(result.ok).toBe(false);
    expect(result.message).toContain(
      "Theme was applied but updating NIGHTSHIFT's configuration failed",
    );
    expect(result.message).toContain("the previous terminal settings were restored");
    expect(fs.readFileSync(settingsPath, "utf8")).toBe(before);
    expect(listBackups().length).toBeGreaterThan(0);
  });

  /**
   * `locateWindowsTerminalSettings` accepts any path `fs.existsSync` returns true for, and
   * `existsSync` is true for a directory, a 0-byte file and a symlink alike. Each of those
   * therefore reaches `applyThemeFileOnly` as a settings path, which is the one place in the
   * product that rewrites a file the user did not hand to us by name. What matters is not the
   * errno but that the engine refuses, says so, and leaves the thing on disk as it found it.
   */
  describe("when the located settings path is not a plain JSON file", () => {
    it("refuses when settings.json is a directory, and leaves the directory intact", () => {
      fs.rmSync(settingsPath);
      fs.mkdirSync(settingsPath);
      fs.writeFileSync(path.join(settingsPath, "canary.txt"), "KEEP");

      const result = applyThemeToWindowsTerminal("ghost-protocol");

      expect(result.ok).toBe(false);
      // The copy is attempted before anything is read or written, so the refusal has to come
      // from the backup step - errno differs by platform (EPERM on Windows, EISDIR elsewhere),
      // so the assertion is on the stage and the path, never the code.
      expect(result.message).toContain("Failed to create a backup before applying the theme");
      expect(result.message).toContain(settingsPath);
      expect(fs.statSync(settingsPath).isDirectory()).toBe(true);
      expect(fs.readFileSync(path.join(settingsPath, "canary.txt"), "utf8")).toBe("KEEP");
      // A backup entry directory is created before the copy is attempted, so the failed attempt
      // leaves one behind with no metadata.json. It must not surface as a restorable backup -
      // offering a phantom id from `backup list` would be worse than offering none.
      expect(listBackups()).toEqual([]);
      expect(tryReadConfig().ok).toBe(true);
      expect(readConfig().activeThemeId).toBeNull();
    });

    it.each([
      ["0-byte", ""],
      ["whitespace-only", "   \r\n\t "],
    ])("refuses a %s settings.json and restores it byte-for-byte", (_label, content) => {
      fs.writeFileSync(settingsPath, content);

      const result = applyThemeToWindowsTerminal("ghost-protocol");

      expect(result.ok).toBe(false);
      expect(result.message).toContain("restored previous settings");
      expect(result.message).toContain("is not valid JSON");
      // The rollback path is the point: an unparseable file must come back unchanged rather
      // than being replaced with a NIGHTSHIFT-shaped settings.json the user never had.
      expect(fs.readFileSync(settingsPath, "utf8")).toBe(content);
      expect(readConfig().activeThemeId).toBeNull();
    });

    it("D-1: replaces a symlinked settings.json with a regular file and still reports success", () => {
      // A settings.json symlinked into a dotfiles repo is a common setup. `atomicWriteFileSync`
      // renames over its target, so the link is severed and the user's tracked file keeps the
      // OLD content - while the result says `ok`. `restoreBackup` guards exactly this with
      // `assertNotSymlink`; the Windows Terminal write does not.
      //
      // This pins the CURRENT behaviour so the defect is visible and a fix has to flip these
      // assertions deliberately. It is not an endorsement of it.
      const tracked = path.join(tmpRoot, "dotfiles-settings.json");
      fs.writeFileSync(tracked, JSON.stringify({ copyOnSelect: true, fromDotfiles: true }));
      fs.rmSync(settingsPath);
      try {
        fs.symlinkSync(tracked, settingsPath, "file");
      } catch {
        // Creating a file symlink on Windows needs Developer Mode or elevation. Returning is
        // honest; asserting as though it had been created would not be.
        return;
      }
      expect(fs.lstatSync(settingsPath).isSymbolicLink()).toBe(true);

      const result = applyThemeToWindowsTerminal("ghost-protocol");

      expect(result.ok).toBe(true);
      expect(fs.lstatSync(settingsPath).isSymbolicLink()).toBe(false);
      const tracked_after = JSON.parse(fs.readFileSync(tracked, "utf8"));
      expect(tracked_after.fromDotfiles).toBe(true);
      expect(tracked_after.schemes).toBeUndefined();
      // The theme did land somewhere Windows Terminal will read, which is why nothing
      // currently reports a problem.
      const written = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      expect(written.profiles.defaults.colorScheme).toBe("Ghost Protocol");
    });
  });

  describe("recordActiveState (shared by theme apply and profile apply)", () => {
    it("returns the caller's own success message and carries the backup id through", () => {
      const result = recordActiveState(
        { ok: true, message: "file applied", backupId: "b-1" },
        { subject: "Theme", success: "caller's message", record: () => {} },
      );
      expect(result).toEqual({ ok: true, message: "caller's message", backupId: "b-1" });
    });

    it("names the subject in the failure message, so the two callers stay distinguishable", () => {
      const failing = () => {
        throw new Error("write blew up");
      };
      const asTheme = recordActiveState(
        { ok: true, message: "x", backupId: undefined },
        { subject: "Theme", success: "unused", record: failing },
      );
      const asProfile = recordActiveState(
        { ok: true, message: "x", backupId: undefined },
        { subject: "Profile's theme", success: "unused", record: failing },
      );

      expect(asTheme.ok).toBe(false);
      expect(asTheme.message).toMatch(/^Theme was applied but updating/);
      expect(asTheme.message).toContain("write blew up");
      expect(asProfile.message).toMatch(/^Profile's theme was applied but updating/);
    });

    it("initializes the config when none exists yet", () => {
      expect(tryReadConfig().ok).toBe(true);
      expect(fs.existsSync(path.join(appData, "nightshift", "config.json"))).toBe(false);

      const result = recordActiveState(
        { ok: true, message: "x", backupId: "b-1" },
        { subject: "Theme", success: "done", record: () => {} },
      );

      expect(result.ok).toBe(true);
      expect(fs.existsSync(path.join(appData, "nightshift", "config.json"))).toBe(true);
    });
  });
});
