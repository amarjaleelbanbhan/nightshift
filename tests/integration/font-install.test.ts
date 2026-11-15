import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runFontInstall, renderFontInstallProposal } from "../../src/cli/commands/font.js";
import {
  buildFontInstallPlan,
  executeFontInstall,
  verifyFontFamilies,
} from "../../src/core/fonts/install.js";

/**
 * `nightshift font install`, driven against a temporary LOCALAPPDATA.
 *
 * It is never run against the real one: this command's whole job is writing into
 * `%LOCALAPPDATA%\Microsoft\Windows\Fonts`, so a test that got the environment wrong would
 * install fixture fonts onto the developer's machine. WINDIR is repointed at an empty directory
 * for the same reason the temp LOCALAPPDATA exists - so verification answers from the fixture
 * tree rather than from whatever 300 fonts this host happens to ship.
 *
 * The font fixtures are real sfnt bytes (header, table directory, `name` table), because the
 * family name the install verifies against is read out of that table by the same parser
 * `font list` uses - a stub file would exercise none of it.
 */

/** A one-font sfnt file declaring `family` in a Windows/en-US `name` record (id 1). */
function fontFile(family: string): Buffer {
  const value = Buffer.from(family, "utf16le");
  value.swap16(); // name records are UTF-16BE
  const name = Buffer.alloc(6 + 12 + value.length);
  name.writeUInt16BE(1, 2); // one record
  name.writeUInt16BE(18, 4); // string storage starts after the single record
  name.writeUInt16BE(3, 6); // platformID: Windows
  name.writeUInt16BE(1, 8); // encodingID
  name.writeUInt16BE(0x0409, 10); // languageID: en-US
  name.writeUInt16BE(1, 12); // nameID: family
  name.writeUInt16BE(value.length, 14);
  name.writeUInt16BE(0, 16); // offset into storage
  value.copy(name, 18);

  const header = Buffer.alloc(12 + 16);
  header.writeUInt32BE(0x00010000, 0); // sfntVersion
  header.writeUInt16BE(1, 4); // numTables
  header.write("name", 12, "latin1");
  header.writeUInt32BE(header.length, 20); // table offset
  header.writeUInt32BE(name.length, 24);
  return Buffer.concat([header, name]);
}

describe("nightshift font install", () => {
  let tmpRoot: string;
  let localAppData: string;
  let fontDir: string;
  let downloads: string;
  let sourceFont: string;
  let original: { localAppData?: string | undefined; windir?: string | undefined };
  let out: string[];

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-fontinstall-"));
    localAppData = path.join(tmpRoot, "LocalAppData");
    fontDir = path.join(localAppData, "Microsoft", "Windows", "Fonts");
    downloads = path.join(tmpRoot, "Downloads");
    sourceFont = path.join(downloads, "CascadiaCode.ttf");
    fs.mkdirSync(downloads, { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "FakeWindows"));
    fs.writeFileSync(sourceFont, fontFile("NIGHTSHIFT Fixture Mono"));

    original = { localAppData: process.env.LOCALAPPDATA, windir: process.env.WINDIR };
    process.env.LOCALAPPDATA = localAppData;
    process.env.WINDIR = path.join(tmpRoot, "FakeWindows");

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
    if (original.localAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = original.localAppData;
    if (original.windir === undefined) delete process.env.WINDIR;
    else process.env.WINDIR = original.windir;
    process.exitCode = 0;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("builds a proposal that names every write, and writes nothing building it", () => {
    const plan = buildFontInstallPlan(sourceFont);

    expect(plan.problem).toBeNull();
    expect(plan.support).toBe("supported");
    expect(plan.fontDir).toBe(fontDir);
    expect(plan.families).toEqual(["NIGHTSHIFT Fixture Mono"]);
    expect(plan.files).toEqual([
      {
        source: sourceFont,
        destination: path.join(fontDir, "CascadiaCode.ttf"),
        families: ["NIGHTSHIFT Fixture Mono"],
        replaces: false,
      },
    ]);

    const rendered = renderFontInstallProposal(plan);
    expect(rendered).toContain("Font install proposal");
    expect(rendered).toContain(path.join(fontDir, "CascadiaCode.ttf"));
    expect(rendered).toContain("NIGHTSHIFT Fixture Mono");
    expect(rendered).toContain("+ add");
    // The limitation is in the proposal, before approval - not discovered afterwards.
    expect(rendered).toContain("not performed");
    expect(rendered).toContain("does NOT create the registry value");

    // The proof: building and rendering created neither the font directory nor anything in it.
    expect(fs.existsSync(fontDir)).toBe(false);
  });

  it("prints the proposal and writes NOTHING without a TTY and without --yes", async () => {
    // vitest workers have no TTY on stdin/stdout, which is the condition under test.
    expect(process.stdin.isTTY).toBeFalsy();

    await runFontInstall(sourceFont, {});

    const text = out.join("\n");
    expect(text).toContain("Font install proposal");
    expect(text).toContain("Nothing has been written");
    expect(text).toContain("--yes");
    expect(fs.existsSync(fontDir)).toBe(false);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("with --yes: copies the file, then confirms the family by re-running detection", async () => {
    await runFontInstall(sourceFont, { yes: true });

    const installed = path.join(fontDir, "CascadiaCode.ttf");
    expect(fs.readFileSync(installed)).toEqual(fs.readFileSync(sourceFont));

    const text = out.join("\n");
    expect(text).toContain("Copied 1 font file");
    expect(text).toContain('"NIGHTSHIFT Fixture Mono" is now found');
    // The half that did not happen is reported as plainly as the half that did.
    expect(text).toContain("not registered with Windows");
    expect(text).toContain(
      'reg add "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts" /v "NIGHTSHIFT Fixture Mono (TrueType)"',
    );
    expect(text).toContain(installed);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("reports a second install of the same file as a replacement, not an addition", async () => {
    await runFontInstall(sourceFont, { yes: true });

    const plan = buildFontInstallPlan(sourceFont);
    expect(plan.files[0]?.replaces).toBe(true);
    expect(renderFontInstallProposal(plan)).toContain("~ replace");
  });

  it("installs every font file in a directory, and ignores the rest of its contents", async () => {
    fs.writeFileSync(path.join(downloads, "Fixture-Bold.otf"), fontFile("NIGHTSHIFT Fixture Bold"));
    fs.writeFileSync(path.join(downloads, "README.txt"), "not a font");

    const plan = buildFontInstallPlan(downloads);
    expect(plan.families).toEqual(["NIGHTSHIFT Fixture Bold", "NIGHTSHIFT Fixture Mono"]);

    await runFontInstall(downloads, { yes: true });

    expect(fs.readdirSync(fontDir).sort()).toEqual(["CascadiaCode.ttf", "Fixture-Bold.otf"]);
    // .otf is registered as OpenType, not TrueType.
    expect(out.join("\n")).toContain('"NIGHTSHIFT Fixture Bold (OpenType)"');
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("refuses a file whose extension is not a font extension, and writes nothing", async () => {
    const notAFont = path.join(downloads, "README.txt");
    fs.writeFileSync(notAFont, "not a font");

    await runFontInstall(notAFont, {});

    const text = out.join("\n");
    expect(text).toContain("is not a font file");
    expect(text).not.toContain("Font install proposal");
    expect(fs.existsSync(fontDir)).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("refuses a path containing a `..` segment, and writes nothing", async () => {
    const traversal = path.join("..", "..", "Windows", "Fonts", "consola.ttf");

    await runFontInstall(traversal, {});

    const text = out.join("\n");
    expect(text).toContain('contains a ".." segment');
    expect(text).not.toContain("Font install proposal");
    expect(fs.existsSync(fontDir)).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("refuses a file with a font extension that declares no family", async () => {
    // It could not be verified after installing, and an unverifiable install is exactly what
    // this command must never report as done - so it is refused before any write.
    const garbage = path.join(downloads, "truncated.ttf");
    fs.writeFileSync(garbage, Buffer.from([0x00, 0x01, 0x00, 0x00]));

    await runFontInstall(garbage, { yes: true });

    expect(out.join("\n")).toContain("no readable family name");
    expect(fs.existsSync(fontDir)).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("refuses a missing path, a directory with no fonts, and an oversized font file", () => {
    expect(buildFontInstallPlan(path.join(downloads, "nope.ttf")).problem).toContain(
      "No file or directory found",
    );

    const empty = path.join(tmpRoot, "empty");
    fs.mkdirSync(empty);
    expect(buildFontInstallPlan(empty).problem).toContain("contains no .ttf, .otf, .ttc files");

    const huge = path.join(downloads, "huge.ttf");
    fs.writeFileSync(huge, Buffer.alloc(33 * 1024 * 1024));
    // The size is read from `stat`, so the file is refused without ever being allocated.
    expect(buildFontInstallPlan(huge).problem).toContain("exceeds the 33554432-byte font");
  });

  it("refuses a directory holding more font files than one install may copy", () => {
    const many = path.join(tmpRoot, "many");
    fs.mkdirSync(many);
    for (let i = 0; i <= 256; i++) fs.writeFileSync(path.join(many, `f${i}.ttf`), "");

    expect(buildFontInstallPlan(many).problem).toContain("exceeds the 256-file limit");
  });

  it("refuses a symlinked source so the proposal names the file that is really read", () => {
    const link = path.join(downloads, "link.ttf");
    try {
      fs.symlinkSync(sourceFont, link, "file");
    } catch {
      return; // A file symlink on Windows needs Developer Mode or elevation.
    }
    expect(buildFontInstallPlan(link).problem).toContain("is a symbolic link");
  });

  it("reports honestly when the family is still not found after the copy", async () => {
    // The verification exists for exactly this case: the copy reported success and the family
    // is still not installed. Reaching it without a bug means making the directory the copy
    // landed in stop being the one the detector resolves fonts from, which is what repointing
    // LOCALAPPDATA after the plan was built does.
    const plan = buildFontInstallPlan(sourceFont);
    process.env.LOCALAPPDATA = path.join(tmpRoot, "Elsewhere");

    const result = executeFontInstall(plan);

    expect(result.copied).toHaveLength(1);
    expect(result.failed).toEqual([]);
    expect(fs.existsSync(path.join(fontDir, "CascadiaCode.ttf"))).toBe(true);
    expect(result.verified).toEqual([{ family: "NIGHTSHIFT Fixture Mono", found: false }]);
  });

  it("reports a file it could not copy instead of claiming the install succeeded", async () => {
    // The destination is occupied by a directory, so the atomic rename cannot land. Both halves
    // of the honest report appear here: the copy that failed, and the family that is therefore
    // still not found when detection is re-run.
    fs.mkdirSync(path.join(fontDir, "CascadiaCode.ttf"), { recursive: true });

    await runFontInstall(sourceFont, { yes: true });

    const text = out.join("\n");
    expect(text).toContain("Could not copy");
    expect(text).toContain("The install did not complete");
    expect(text).toContain("is still not found by NIGHTSHIFT's font detection");
    expect(text).not.toContain("is now found");
    expect(process.exitCode).toBe(1);
  });

  it("reports a family as not found rather than throwing when nothing is installed", () => {
    expect(verifyFontFamilies(["NIGHTSHIFT No Such Family"])).toEqual([
      { family: "NIGHTSHIFT No Such Family", found: false },
    ]);
  });

  it("reports unknown, not a failure, on win32 with no per-user font directory", async () => {
    delete process.env.LOCALAPPDATA;

    const plan = buildFontInstallPlan(sourceFont);
    expect(plan.support).toBe("unknown");
    expect(plan.fontDir).toBeNull();
    expect(plan.problem).toContain("No per-user Windows font directory");

    await runFontInstall(sourceFont, { yes: true });
    expect(out.join("\n")).toContain("LOCALAPPDATA");
    expect(process.exitCode).toBe(1);
  });
});

describe("font install on a platform that has no Windows font directory", () => {
  afterEach(() => {
    vi.doUnmock("node:os");
    vi.resetModules();
  });

  it("reports unsupported rather than guessing, and plans no writes", async () => {
    vi.resetModules();
    vi.doMock("node:os", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:os")>();
      const patched = { ...actual, platform: () => "linux" as const };
      return { ...patched, default: patched };
    });

    const { buildFontInstallPlan: build } = await import("../../src/core/fonts/install.js");
    const plan = build("/tmp/whatever.ttf");

    // Asserted first: if the mock stopped being applied, the module would report the real host
    // and the assertions below would pass for the wrong reason.
    expect(plan.platform).toBe("linux");
    expect(plan.support).toBe("unsupported");
    expect(plan.fontDir).toBeNull();
    expect(plan.files).toEqual([]);
    expect(plan.problem).toContain("not implemented on linux");
  });
});
