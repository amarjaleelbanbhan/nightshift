import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { locateWindowsTerminalSettings } from "../../src/adapters/windows-terminal/locate.js";

/**
 * `locateWindowsTerminalSettings` decides which file every theme and profile apply rewrites.
 * Two things about it are load-bearing and neither was pinned:
 *
 *  1. **Which candidate wins** when more than one Windows Terminal is installed. Store stable,
 *     Store Preview and the unpackaged build can all be present at once - Preview is a separate
 *     app with its own settings.json, so picking it for a user who runs the stable build would
 *     theme a terminal they do not use and leave the one they do use untouched.
 *  2. **What `fs.existsSync` admits.** It is true for a directory, a 0-byte file and a symlink
 *     alike, so each of those is a settings path this function will hand to the apply engine.
 *     Those are pinned here as inputs the locator produces on purpose, and in
 *     `tests/integration/theme-apply-engine.test.ts` as inputs the engine must survive.
 *
 * Everything runs against a temporary LOCALAPPDATA; the real one is never read.
 */

const STORE = ["Packages", "Microsoft.WindowsTerminal_8wekyb3d8bbwe", "LocalState"];
const PREVIEW = ["Packages", "Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe", "LocalState"];
const UNPACKAGED = ["Microsoft", "WindowsTerminal"];

describe("locateWindowsTerminalSettings", () => {
  let tmpRoot: string;
  let localAppData: string;
  let originalLocalAppData: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-wt-locate-"));
    localAppData = path.join(tmpRoot, "LocalAppData");
    fs.mkdirSync(localAppData, { recursive: true });
    originalLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = localAppData;
  });

  afterEach(() => {
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  /** Creates a settings.json for one install flavour and returns its path. */
  function install(suffix: string[], content = '{"profiles":{"defaults":{}}}'): string {
    const dir = path.join(localAppData, ...suffix);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, content);
    return file;
  }

  it("returns null when no Windows Terminal is installed", () => {
    expect(locateWindowsTerminalSettings()).toBeNull();
  });

  it.each([
    ["unset", undefined],
    ["an empty string", ""],
  ])("returns null when LOCALAPPDATA is %s, even with a terminal on disk", (_label, value) => {
    // The files exist; only the env var is missing. A locator that fell back to a hard-coded
    // path or to cwd would find them anyway, which is the failure being excluded.
    install(STORE);
    if (value === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = value;

    expect(locateWindowsTerminalSettings()).toBeNull();
  });

  it.each([
    ["Store stable", STORE],
    ["Store Preview", PREVIEW],
    ["the unpackaged build", UNPACKAGED],
  ])("finds a lone %s install", (_label, suffix) => {
    const expected = install(suffix);
    expect(locateWindowsTerminalSettings()).toBe(expected);
  });

  it("prefers Store stable over Preview and the unpackaged build when all three exist", () => {
    const stable = install(STORE);
    const preview = install(PREVIEW);
    const unpackaged = install(UNPACKAGED);

    const located = locateWindowsTerminalSettings();

    expect(located).toBe(stable);
    expect(located).not.toBe(preview);
    expect(located).not.toBe(unpackaged);
  });

  it("prefers Preview over the unpackaged build when stable is absent", () => {
    const preview = install(PREVIEW);
    install(UNPACKAGED);
    expect(locateWindowsTerminalSettings()).toBe(preview);
  });

  it("ignores an install whose directory exists but holds no settings.json", () => {
    // A leftover LocalState folder from an uninstalled Store package is common. Matching on the
    // directory rather than the file would return a path that cannot be read.
    fs.mkdirSync(path.join(localAppData, ...STORE), { recursive: true });
    const unpackaged = install(UNPACKAGED);
    expect(locateWindowsTerminalSettings()).toBe(unpackaged);
  });

  describe("paths that exist but are not a readable JSON file", () => {
    it("returns a settings.json that is a directory, because existsSync accepts one", () => {
      const asDir = path.join(localAppData, ...STORE, "settings.json");
      fs.mkdirSync(asDir, { recursive: true });

      // Documented, not endorsed: the locator cannot tell the difference, so refusing this is
      // the apply engine's job (see theme-apply-engine.test.ts). What must not happen is
      // silently falling through to a *different* terminal's settings and theming that
      // instead - the user would be told a path that is not the one that was written.
      expect(locateWindowsTerminalSettings()).toBe(asDir);
    });

    it("returns a 0-byte settings.json rather than treating empty as absent", () => {
      const empty = install(STORE, "");
      expect(fs.statSync(empty).size).toBe(0);
      expect(locateWindowsTerminalSettings()).toBe(empty);
    });

    it("returns a symlinked settings.json, which existsSync resolves through", () => {
      const target = path.join(tmpRoot, "dotfiles-settings.json");
      fs.writeFileSync(target, '{"fromDotfiles":true}');
      const linkDir = path.join(localAppData, ...STORE);
      fs.mkdirSync(linkDir, { recursive: true });
      const link = path.join(linkDir, "settings.json");
      try {
        fs.symlinkSync(target, link, "file");
      } catch {
        // A file symlink on Windows needs Developer Mode or elevation. Returning is honest;
        // asserting as though the link existed would not be.
        return;
      }

      expect(locateWindowsTerminalSettings()).toBe(link);
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    });

    it("does not report a broken symlink as an install", () => {
      const linkDir = path.join(localAppData, ...STORE);
      fs.mkdirSync(linkDir, { recursive: true });
      const link = path.join(linkDir, "settings.json");
      try {
        fs.symlinkSync(path.join(tmpRoot, "gone.json"), link, "file");
      } catch {
        return;
      }
      // existsSync follows the link, so a dangling one is correctly invisible here - and the
      // unpackaged install behind it is found instead.
      const unpackaged = install(UNPACKAGED);
      expect(locateWindowsTerminalSettings()).toBe(unpackaged);
    });
  });
});
