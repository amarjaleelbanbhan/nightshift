import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { applyProfile } from "../../src/cli/commands/profile.js";
import { readConfig } from "../../src/core/config/store.js";
import { listBackups } from "../../src/backup/manager.js";
import { getUserProfilesDir } from "../../src/core/config/paths.js";

function makeFakeWindowsTerminalSettings(localAppData: string, content: object): string {
  const pkgDir = path.join(
    localAppData,
    "Packages",
    "Microsoft.WindowsTerminal_8wekyb3d8bbwe",
    "LocalState",
  );
  fs.mkdirSync(pkgDir, { recursive: true });
  const settingsPath = path.join(pkgDir, "settings.json");
  fs.writeFileSync(settingsPath, JSON.stringify(content, null, 2));
  return settingsPath;
}

describe("profile apply", () => {
  let tmpRoot: string;
  let localAppData: string;
  let appData: string;
  let settingsPath: string;
  let originalLocalAppData: string | undefined;
  let originalAppData: string | undefined;

  const originalSettings = {
    $help: "https://aka.ms/terminal-documentation",
    defaultProfile: "{some-guid}",
    copyOnSelect: true,
    profiles: { defaults: {}, list: [{ name: "PowerShell" }] },
  };

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-profile-apply-"));
    localAppData = path.join(tmpRoot, "LocalAppData");
    appData = path.join(tmpRoot, "AppData");
    settingsPath = makeFakeWindowsTerminalSettings(localAppData, originalSettings);

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

  it("applies a profile's theme, preserves unrelated settings, and updates active state", () => {
    const result = applyProfile("ghost-protocol-default");
    expect(result.ok).toBe(true);
    expect(result.backupId).toBeDefined();

    const written = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(written.defaultProfile).toBe(originalSettings.defaultProfile);
    expect(written.copyOnSelect).toBe(true);
    expect(written.profiles.list).toHaveLength(1);
    expect(written.profiles.defaults.colorScheme).toBe("Ghost Protocol");

    const config = readConfig();
    expect(config.activeProfileId).toBe("ghost-protocol-default");
    expect(config.activeThemeId).toBe("ghost-protocol");

    expect(listBackups().length).toBeGreaterThan(0);
  });

  it("fails cleanly for an unknown profile id without touching settings or config", () => {
    const before = fs.readFileSync(settingsPath, "utf8");
    const result = applyProfile("does-not-exist");
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(settingsPath, "utf8")).toBe(before);
    expect(readConfig().activeProfileId).toBeNull();
  });

  it("fails cleanly when a user profile references a theme that no longer exists, leaving active state untouched", () => {
    // Apply a good profile first so there's a known-good active state to protect.
    applyProfile("ghost-protocol-default");

    const dir = getUserProfilesDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "drifted.json"),
      JSON.stringify({ id: "drifted", schemaVersion: "1.0", name: "Drifted", themeId: "does-not-exist-anymore" }),
    );

    const result = applyProfile("drifted");
    expect(result.ok).toBe(false);
    expect(readConfig().activeProfileId).toBe("ghost-protocol-default");
  });

  it("leaves the active profile unchanged when a later apply attempt fails", () => {
    applyProfile("ghost-protocol-default");
    applyProfile("does-not-exist");
    expect(readConfig().activeProfileId).toBe("ghost-protocol-default");
    expect(readConfig().activeThemeId).toBe("ghost-protocol");
  });

  it("restores the terminal backup if updating NIGHTSHIFT's own config fails", () => {
    // Force the config *write* to fail without touching backups: pre-create config.json as a
    // directory, so reading/writing it as a file throws EISDIR, while the sibling backups/
    // directory under the same nightshift root is untouched and still works normally.
    fs.mkdirSync(path.join(appData, "nightshift", "config.json"), { recursive: true });

    const before = fs.readFileSync(settingsPath, "utf8");
    const result = applyProfile("ghost-protocol-default");

    expect(result.ok).toBe(false);
    expect(fs.readFileSync(settingsPath, "utf8")).toBe(before);
    expect(listBackups().length).toBeGreaterThan(0);
  });
});
