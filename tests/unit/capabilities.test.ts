import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// Statically imported so the first test sees the genuine, unmocked detector. The mocked
// variants below go through detectAs(), which resets the module registry and re-imports.
import { detectCapabilities } from "../../src/core/capabilities/detect.js";

/**
 * Runs detectCapabilities() as if the host were `platform`.
 *
 * node:os is mocked rather than the whole module graph because it is the only thing standing
 * between the test and the platform branches: detect.ts reads os.platform() and os.homedir(),
 * while locate.ts reads process.env.LOCALAPPDATA and the real filesystem. So the Windows
 * Terminal lookup can be driven with a real temp directory and needs no fs mocking.
 *
 * Every test below asserts the returned `platform` first. That is deliberate: if the mock ever
 * stops being applied, the module under test would silently report the real host ("win32") and
 * the off-platform assertions would pass for the wrong reason. Asserting the mocked value makes
 * a vacuous pass impossible - which is exactly the failure this file previously had.
 */
async function detectAs(platform: NodeJS.Platform, homedir: string) {
  vi.resetModules();
  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    const patched = { ...actual, platform: () => platform, homedir: () => homedir };
    return { ...patched, default: patched };
  });
  const { detectCapabilities } = await import("../../src/core/capabilities/detect.js");
  return detectCapabilities();
}

describe("detectCapabilities", () => {
  let tmpRoot: string;
  let localAppData: string;
  let originalLocalAppData: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-caps-"));
    localAppData = path.join(tmpRoot, "LocalAppData");
    originalLocalAppData = process.env.LOCALAPPDATA;
  });

  afterEach(() => {
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    vi.doUnmock("node:os");
    vi.resetModules();
  });

  /** Writes a Windows Terminal settings.json at the Store package path under localAppData. */
  function writeWindowsTerminalSettings(): void {
    const dir = path.join(
      localAppData,
      "Packages",
      "Microsoft.WindowsTerminal_8wekyb3d8bbwe",
      "LocalState",
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({ profiles: { defaults: {} } }),
    );
  }

  it("reports the real platform and a defined support level for every capability", () => {
    const caps = detectCapabilities();
    expect(caps.platform).toBe(process.platform);
    expect(["supported", "partial", "unsupported", "unknown"]).toContain(
      caps.windowsTerminal.support,
    );
    expect(["supported", "partial", "unsupported", "unknown"]).toContain(caps.claudeCode.support);
  });

  // The control case. Without it, the two off-platform tests below would be satisfied by a
  // detector that reported "unsupported" unconditionally, which would be just as wrong.
  it("reports Windows Terminal as supported on win32 when settings.json is really there", async () => {
    writeWindowsTerminalSettings();
    process.env.LOCALAPPDATA = localAppData;

    const caps = await detectAs("win32", tmpRoot);

    expect(caps.platform).toBe("win32");
    expect(caps.platformSupport).toBe("supported");
    expect(caps.windowsTerminal.support).toBe("supported");
    expect(caps.windowsTerminal.settingsPath).toContain("settings.json");
  });

  it.each(["linux", "darwin", "freebsd"] as const)(
    "never claims support on %s even when a usable settings.json is present",
    async (platform) => {
      // The strong form of the guarantee. A real Windows Terminal settings.json is on disk and
      // LOCALAPPDATA points at it, so a detector that probed the filesystem before checking the
      // platform would answer "supported" here. It must not: the Windows Terminal adapter is the
      // only implemented adapter, and claiming support off-Windows would be the exact
      // unsubstantiated claim this project's capability reporting exists to prevent.
      writeWindowsTerminalSettings();
      process.env.LOCALAPPDATA = localAppData;

      const caps = await detectAs(platform, tmpRoot);

      expect(caps.platform).toBe(platform);
      expect(caps.platformSupport).toBe("unsupported");
      expect(caps.windowsTerminal.support).toBe("unsupported");
      expect(caps.windowsTerminal.settingsPath).toBeNull();
    },
  );

  it("reports win32 without Windows Terminal as unknown rather than unsupported", async () => {
    // "unknown" and "unsupported" are different claims and the distinction is load-bearing:
    // Windows Terminal may simply not be installed yet on a platform that does support it,
    // which is a fixable state. Saying "unsupported" would tell the user to give up.
    process.env.LOCALAPPDATA = localAppData;
    fs.mkdirSync(localAppData, { recursive: true });

    const caps = await detectAs("win32", tmpRoot);

    expect(caps.platform).toBe("win32");
    expect(caps.platformSupport).toBe("supported");
    expect(caps.windowsTerminal.support).toBe("unknown");
    expect(caps.windowsTerminal.settingsPath).toBeNull();
  });

  it("reports win32 with LOCALAPPDATA unset as unknown, not a crash", async () => {
    delete process.env.LOCALAPPDATA;

    const caps = await detectAs("win32", tmpRoot);

    expect(caps.windowsTerminal.support).toBe("unknown");
    expect(caps.windowsTerminal.settingsPath).toBeNull();
  });

  it("reports Claude Code as unknown when the settings file is absent", async () => {
    const caps = await detectAs("win32", path.join(tmpRoot, "no-such-home"));

    expect(caps.claudeCode.support).toBe("unknown");
    expect(caps.claudeCode.settingsPath).toBeNull();
  });

  it("reports Claude Code as partial - never supported - when the settings file exists", async () => {
    // "partial" is the honest level: the file is detected, but nothing reads or writes it yet.
    const home = path.join(tmpRoot, "home");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), "{}");

    const caps = await detectAs("win32", home);

    expect(caps.claudeCode.support).toBe("partial");
    expect(caps.claudeCode.settingsPath).toContain(".claude");
  });

  it("builds the Claude Code path with the platform separator, not mixed separators", async () => {
    // Regression guard for F7: this path was built by string concatenation, so `doctor` and
    // `status` printed `C:\Users\<user>/.claude/settings.json`.
    const home = path.join(tmpRoot, "home2");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), "{}");

    const caps = await detectAs("win32", home);

    expect(caps.claudeCode.settingsPath).toBe(path.join(home, ".claude", "settings.json"));
  });
});
