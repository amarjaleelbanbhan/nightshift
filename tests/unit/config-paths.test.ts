import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";

/**
 * `getNightshiftRoot()` decides where every file NIGHTSHIFT writes goes: `config.json`, user
 * themes, user profiles and every backup snapshot. Three of its four branches - darwin, the
 * XDG path, and the win32 `APPDATA`-unset fallback - had never been executed, so nothing
 * checked that a non-Windows run lands somewhere sane rather than in the Windows branch's
 * `AppData\Roaming`.
 *
 * `node:os` is mocked with the `vi.doMock` + `vi.resetModules()` + dynamic-import technique from
 * `tests/unit/capabilities.test.ts`, because `os.platform()` and `os.homedir()` are the only
 * inputs besides the two env vars. Nothing here touches the filesystem - the module under test
 * resolves paths and deliberately creates nothing.
 *
 * Vacuous passes are excluded structurally: each platform's expected path is a shape no other
 * branch can produce, so a dropped mock reports the host's own branch and fails rather than
 * passing for the wrong reason.
 */
async function rootAs(platform: NodeJS.Platform, homedir: string): Promise<string> {
  vi.resetModules();
  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    const patched = { ...actual, platform: () => platform, homedir: () => homedir };
    return { ...patched, default: patched };
  });
  const { getNightshiftRoot } = await import("../../src/core/config/paths.js");
  return getNightshiftRoot();
}

const HOME = path.join(path.sep === "\\" ? "C:\\fake" : "/fake", "home");

describe("getNightshiftRoot", () => {
  let originalAppData: string | undefined;
  let originalXdg: string | undefined;

  beforeEach(() => {
    originalAppData = process.env.APPDATA;
    originalXdg = process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    vi.doUnmock("node:os");
    vi.resetModules();
  });

  it("uses APPDATA on win32", async () => {
    process.env.APPDATA = path.join(HOME, "AppData", "Roaming");
    expect(await rootAs("win32", HOME)).toBe(path.join(HOME, "AppData", "Roaming", "nightshift"));
  });

  it("falls back to ~/AppData/Roaming on win32 when APPDATA is unset", async () => {
    // Reachable in a stripped service account environment and in any child process started
    // with a scrubbed env. Without this branch the root would be `undefined\nightshift`.
    delete process.env.APPDATA;
    expect(await rootAs("win32", HOME)).toBe(path.join(HOME, "AppData", "Roaming", "nightshift"));
  });

  it("ignores XDG_CONFIG_HOME on win32", async () => {
    // Set by WSL interop and by some terminal wrappers on Windows too. The win32 branch must
    // not read it, or a NIGHTSHIFT run inside such a shell would use a different config root
    // from one started outside it.
    process.env.APPDATA = path.join(HOME, "AppData", "Roaming");
    process.env.XDG_CONFIG_HOME = path.join(HOME, ".config");
    expect(await rootAs("win32", HOME)).toBe(path.join(HOME, "AppData", "Roaming", "nightshift"));
  });

  it("uses ~/Library/Application Support on darwin, ignoring both env vars", async () => {
    // macOS has no APPDATA and the platform convention is not XDG, so neither var may win.
    process.env.APPDATA = path.join(HOME, "AppData", "Roaming");
    process.env.XDG_CONFIG_HOME = path.join(HOME, ".config");

    const root = await rootAs("darwin", HOME);

    expect(root).toBe(path.join(HOME, "Library", "Application Support", "nightshift"));
    expect(root).not.toContain("Roaming");
    expect(root).not.toContain(".config");
  });

  it.each(["linux", "freebsd", "openbsd", "android"] as const)(
    "uses XDG_CONFIG_HOME on %s when it is set",
    async (platform) => {
      process.env.XDG_CONFIG_HOME = path.join(HOME, "xdg");
      process.env.APPDATA = path.join(HOME, "AppData", "Roaming");

      const root = await rootAs(platform, HOME);

      expect(root).toBe(path.join(HOME, "xdg", "nightshift"));
      // Every platform that is neither win32 nor darwin takes this branch; none may leak into
      // the Windows one just because APPDATA happens to be set.
      expect(root).not.toContain("Roaming");
    },
  );

  it("falls back to ~/.config on linux when XDG_CONFIG_HOME is unset", async () => {
    delete process.env.XDG_CONFIG_HOME;
    expect(await rootAs("linux", HOME)).toBe(path.join(HOME, ".config", "nightshift"));
  });

  it("puts themes, profiles, backups and config.json all under that one root", async () => {
    // The four accessors are what the rest of the codebase actually calls. They must all be
    // derived from the root rather than re-deriving it, or a platform fix would have to be
    // applied in five places.
    vi.resetModules();
    vi.doMock("node:os", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:os")>();
      const patched = { ...actual, platform: () => "darwin" as const, homedir: () => HOME };
      return { ...patched, default: patched };
    });
    const paths = await import("../../src/core/config/paths.js");

    const root = paths.getNightshiftRoot();
    expect(root).toContain("Application Support");
    expect(paths.getConfigFilePath()).toBe(path.join(root, "config.json"));
    expect(paths.getUserThemesDir()).toBe(path.join(root, "themes"));
    expect(paths.getUserProfilesDir()).toBe(path.join(root, "profiles"));
    expect(paths.getBackupsDir()).toBe(path.join(root, "backups"));
  });
});
