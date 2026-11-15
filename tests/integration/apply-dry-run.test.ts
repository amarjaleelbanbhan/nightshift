import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runThemeApply } from "../../src/cli/commands/theme.js";
import { runProfileApply } from "../../src/cli/commands/profile.js";
import { buildApplyPreview } from "../../src/cli/commands/apply-preview.js";
import { mergeThemeIntoSettings } from "../../src/adapters/windows-terminal/apply.js";
import { getTheme } from "../../src/core/themes/registry.js";

/**
 * `theme apply --dry-run` and `profile apply --dry-run` (#31).
 *
 * The central claim - "writes nothing" - is a claim about the filesystem, so it is checked
 * against the filesystem: the settings.json content is hashed before and after, and the whole
 * temp tree is enumerated to prove no backup directory and no config.json appeared. Reading the
 * code would not have caught the defect this feature exists to prevent.
 *
 * Everything runs against a temporary LOCALAPPDATA/APPDATA, as in `theme-apply-engine.test.ts`.
 * `theme apply` is never run without `--dry-run` here - capability detection would find the
 * developer's real settings.json if the environment were not redirected, and the point of this
 * file is that nothing is written at all.
 */

const WT = ["Packages", "Microsoft.WindowsTerminal_8wekyb3d8bbwe", "LocalState"];

/** A settings.json already themed by NIGHTSHIFT: every key the merge touches is present. */
const ALREADY_THEMED = {
  defaultProfile: "{some-guid}",
  profiles: {
    defaults: { colorScheme: "Campbell", useAcrylic: true, font: { face: "Consolas", size: 12 } },
    list: [{ name: "PowerShell" }],
  },
  schemes: [{ name: "Campbell" }, { name: "Ghost Protocol", background: "#000000" }],
};

/** A pristine settings.json: none of the keys the merge touches exist yet. */
const UNTHEMED = {
  defaultProfile: "{some-guid}",
  profiles: { list: [{ name: "PowerShell" }] },
  schemes: [{ name: "Campbell" }],
};

/** Assertions are on the text, not the colour: chalk still emits SGR codes under vitest. */
const stripAnsi = (text: string) => text.replace(/\u001B\[[0-9;]*m/g, "");

describe("apply --dry-run", () => {
  let tmpRoot: string;
  let appData: string;
  let settingsPath: string;
  let originalLocalAppData: string | undefined;
  let originalAppData: string | undefined;
  let originalXdg: string | undefined;
  let out: string[];

  /** Every file and directory under the temp root, so "nothing was created" is checkable. */
  function treeSnapshot(): string[] {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? [`${full}/`, ...walk(full)] : [full];
      });
    return walk(tmpRoot).sort();
  }

  const output = () => stripAnsi(out.join("\n"));

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-dry-run-"));
    const localAppData = path.join(tmpRoot, "LocalAppData");
    appData = path.join(tmpRoot, "AppData");
    settingsPath = path.join(localAppData, ...WT, "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(ALREADY_THEMED, null, 2));

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

  it("writes nothing at all: settings.json byte-identical, no backup directory, exit 0", () => {
    const before = fs.readFileSync(settingsPath);
    const treeBefore = treeSnapshot();

    runThemeApply("ghost-protocol", { dryRun: true });

    expect(fs.readFileSync(settingsPath).equals(before)).toBe(true);
    // The whole temp tree, not just the two paths this feature is known to touch: a backup
    // directory, a config.json or an atomic-write temp file left behind would all show up here.
    expect(treeSnapshot()).toEqual(treeBefore);
    expect(fs.existsSync(path.join(appData, "nightshift"))).toBe(false);
    expect(process.exitCode ?? 0).toBe(0);
    expect(output()).toContain("Nothing was written - no settings.json change, and no backup");
  });

  it("reports a replaced scheme and replaced defaults when they already exist", () => {
    runThemeApply("ghost-protocol", { dryRun: true });
    const text = output();

    expect(text).toMatch(/~ replace\s+schemes\[\] \(name "Ghost Protocol"\)/);
    expect(text).toMatch(
      /~ replace\s+profiles\.defaults\.colorScheme\s+"Campbell" -> "Ghost Protocol"/,
    );
    expect(text).toMatch(
      /~ replace\s+profiles\.defaults\.font\.face\s+"Consolas" -> "Cascadia Code"/,
    );
    expect(text).toMatch(/~ replace\s+profiles\.defaults\.font\.size\s+12 -> 14/);
  });

  it("reports an added scheme and added defaults when the file has none", () => {
    // The add/replace distinction is the whole point of reading the current file: a generic
    // "this will change schemes and profiles.defaults" would have been the same text for both.
    fs.writeFileSync(settingsPath, JSON.stringify(UNTHEMED, null, 2));

    runThemeApply("ghost-protocol", { dryRun: true });
    const text = output();

    expect(text).toMatch(/\+ add\s+schemes\[\] \(name "Ghost Protocol"\)/);
    expect(text).toMatch(/\+ add\s+profiles\.defaults\.colorScheme\s+"Ghost Protocol"/);
    expect(text).toMatch(/\+ add\s+profiles\.defaults\.font\.face\s+"Cascadia Code"/);
    expect(text).toMatch(/\+ add\s+profiles\.defaults\.font\.size\s+14/);
    // The pre-existing Campbell scheme is not reported as changing, because it does not.
    expect(text).not.toContain("Campbell");
  });

  it("names the resolved file and the symlink it was reached through (#27)", () => {
    // A preview that promised to write the link path while the engine writes the target would
    // be worse than no preview: the user would approve a change to a file that is not the one
    // changed. This asserts the preview inherits the engine's resolution rather than repeating
    // its own.
    const tracked = path.join(tmpRoot, "dotfiles-settings.json");
    fs.writeFileSync(tracked, JSON.stringify(ALREADY_THEMED, null, 2));
    fs.rmSync(settingsPath);
    try {
      fs.symlinkSync(tracked, settingsPath, "file");
    } catch {
      return; // A file symlink on Windows needs Developer Mode or elevation.
    }

    runThemeApply("ghost-protocol", { dryRun: true });

    const text = output();
    expect(text).toContain(fs.realpathSync(tracked));
    expect(text).toContain(`(via the symlink ${settingsPath})`);
    expect(fs.lstatSync(settingsPath).isSymbolicLink()).toBe(true);
  });

  it("exits 1 for an unknown theme id, because the user asked about a theme that does not exist", () => {
    runThemeApply("does-not-exist", { dryRun: true });

    expect(process.exitCode).toBe(1);
    expect(output()).toContain('No theme found with id "does-not-exist".');
    expect(output()).not.toContain("Dry run");
  });

  it("refuses a settings.json the write would refuse, before writing anything", () => {
    // `--dry-run` runs the real merge and discards it, so the legacy root-array `profiles` form
    // is reported here rather than discovered by the write. That makes the preview a pre-flight
    // check instead of a second opinion.
    fs.writeFileSync(settingsPath, JSON.stringify({ profiles: [{ name: "PowerShell" }] }));
    const before = fs.readFileSync(settingsPath);

    runThemeApply("ghost-protocol", { dryRun: true });

    expect(process.exitCode).toBe(1);
    expect(output()).toContain("legacy pre-1.0 settings format");
    expect(fs.readFileSync(settingsPath).equals(before)).toBe(true);
  });

  it("warns that the theme's font is not installed, at the moment that is actionable", () => {
    // `doctor` reports this about the *active* theme; applying is when a user can still act on
    // it. Guarded on platform because font detection reports `unsupported` off Windows and
    // claiming a font is missing there would be a false negative.
    if (process.platform !== "win32") return;
    const themesDir = path.join(appData, "nightshift", "themes");
    fs.mkdirSync(themesDir, { recursive: true });
    const theme = {
      id: "font-probe",
      schemaVersion: "1.0",
      name: "Font Probe",
      colors: {
        background: "#000000",
        foreground: "#ffffff",
        primary: "#ff0000",
        secondary: "#00ff00",
        success: "#00ff00",
        warning: "#ffff00",
        error: "#ff0000",
        cursor: "#ffffff",
        selection: "#333333",
      },
      ansi: Object.fromEntries(
        [
          "black",
          "red",
          "green",
          "yellow",
          "blue",
          "purple",
          "cyan",
          "white",
          "brightBlack",
          "brightRed",
          "brightGreen",
          "brightYellow",
          "brightBlue",
          "brightPurple",
          "brightCyan",
          "brightWhite",
        ].map((key) => [key, "#123456"]),
      ),
      typography: { family: "NIGHTSHIFT No Such Font", size: 11 },
    };
    fs.writeFileSync(path.join(themesDir, "font-probe.json"), JSON.stringify(theme));

    const result = buildApplyPreview("font-probe", "theme apply font-probe");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.fontWarning).toContain('"NIGHTSHIFT No Such Font" is not installed');
  });

  describe("unchanged keys (#35)", () => {
    /**
     * Writes a settings.json already carrying exactly what applying `ghost-protocol` would
     * write, by running the real merge and saving its output. Deriving the fixture from the
     * merge rather than hand-writing it is the point: a hand-written "already applied" file
     * would drift from the merge and the test would stop meaning anything.
     */
    function writeFullyApplied(): void {
      const current = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
      const merged = mergeThemeIntoSettings(current, getTheme("ghost-protocol")!);
      fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
    }

    it("reports a key whose value is already correct as same, not as a replacement", () => {
      // ALREADY_THEMED has font.size 12 and ghost-protocol asks for 14, so size is a real
      // replace; point it at 14 instead and the same key must stop being reported as one.
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      settings.profiles.defaults.font.size = 14;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      runThemeApply("ghost-protocol", { dryRun: true });

      const text = output();
      expect(text).toMatch(/= same\s+profiles\.defaults\.font\.size\s+14/);
      expect(text).not.toMatch(/~ replace\s+profiles\.defaults\.font\.size/);
      // The genuinely different keys must still read as changes - suppressing a no-op must not
      // suppress everything.
      expect(text).toMatch(/~ replace\s+profiles\.defaults\.colorScheme/);
    });

    it("says nothing would change when the theme is already fully applied", () => {
      writeFullyApplied();
      const before = fs.readFileSync(settingsPath);
      const treeBefore = treeSnapshot();

      runThemeApply("ghost-protocol", { dryRun: true });

      const text = output();
      expect(text).toContain("would change nothing");
      expect(text).toContain('"Ghost Protocol" is already applied to that file');
      expect(text).not.toContain("~ replace");
      expect(text).not.toContain("+ add");
      // Still a dry run, so the no-change case must write nothing either.
      expect(fs.readFileSync(settingsPath).equals(before)).toBe(true);
      expect(treeSnapshot()).toEqual(treeBefore);
      expect(process.exitCode ?? 0).toBe(0);
    });

    it("treats a reordered scheme as unchanged rather than a false replacement", () => {
      // The scheme comparison is key-order independent on purpose: a user who hand-formats or
      // a tool that rewrites settings.json must not make NIGHTSHIFT claim a change.
      writeFullyApplied();
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      const index = settings.schemes.findIndex(
        (s: { name: string }) => s.name === "Ghost Protocol",
      );
      settings.schemes[index] = Object.fromEntries(
        Object.entries(settings.schemes[index]).reverse(),
      );
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      runThemeApply("ghost-protocol", { dryRun: true });

      expect(output()).toMatch(/= same\s+schemes\[\] \(name "Ghost Protocol"\)/);
    });
  });

  describe("profile apply --dry-run", () => {
    it("previews the profile's theme and writes nothing", () => {
      const before = fs.readFileSync(settingsPath);
      const treeBefore = treeSnapshot();

      runProfileApply("ghost-protocol-default", { dryRun: true });

      const text = output();
      expect(text).toContain("`profile apply ghost-protocol-default` would change");
      expect(text).toMatch(/~ replace\s+profiles\.defaults\.colorScheme/);
      expect(fs.readFileSync(settingsPath).equals(before)).toBe(true);
      expect(treeSnapshot()).toEqual(treeBefore);
      expect(process.exitCode ?? 0).toBe(0);
    });

    it("exits 1 for an unknown profile id without building a preview", () => {
      runProfileApply("does-not-exist", { dryRun: true });

      expect(process.exitCode).toBe(1);
      expect(output()).toContain('No profile found with id "does-not-exist".');
      expect(output()).not.toContain("Dry run");
    });
  });
});
