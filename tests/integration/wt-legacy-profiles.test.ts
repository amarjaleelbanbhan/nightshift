import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { applyThemeFileOnly } from "../../src/core/themes/apply.js";

/**
 * G25 end to end: the product guarantee is not "the merge function throws", it is "the user's
 * settings.json is byte-identical afterwards and the command does not claim success".
 *
 * Pre-fix this exact scenario returned `{ ok: true, message: 'Applied "Ghost Protocol" ...' }`
 * and left `profiles` on disk as `{"0": {...}, "defaults": {...}}` - the profile list gone.
 */

const WT = ["Packages", "Microsoft.WindowsTerminal_8wekyb3d8bbwe", "LocalState"];

const LEGACY_SETTINGS = {
  globals: { defaultProfile: "{guid-1}", initialCols: 120 },
  profiles: [
    { guid: "{guid-1}", name: "PowerShell", commandline: "pwsh.exe" },
    { guid: "{guid-2}", name: "cmd", commandline: "cmd.exe" },
  ],
};

describe("legacy array-form Windows Terminal settings.json (G25)", () => {
  let tmpRoot: string;
  let settingsPath: string;
  let originalLocalAppData: string | undefined;
  let originalAppData: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-wt-legacy-"));
    const localAppData = path.join(tmpRoot, "LocalAppData");
    settingsPath = path.join(localAppData, ...WT, "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(LEGACY_SETTINGS, null, 4));

    originalLocalAppData = process.env.LOCALAPPDATA;
    originalAppData = process.env.APPDATA;
    process.env.LOCALAPPDATA = localAppData;
    process.env.APPDATA = path.join(tmpRoot, "AppData");
  });

  afterEach(() => {
    process.env.LOCALAPPDATA = originalLocalAppData;
    process.env.APPDATA = originalAppData;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("refuses, reports why, and leaves settings.json byte-identical", () => {
    const before = fs.readFileSync(settingsPath, "utf8");

    const result = applyThemeFileOnly("ghost-protocol");

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/legacy/i);
    expect(result.message).toContain('"profiles"');
    expect(fs.readFileSync(settingsPath, "utf8")).toBe(before);
    expect(JSON.parse(before).profiles).toEqual(LEGACY_SETTINGS.profiles);
  });
});
