import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isProbableNerdFont,
  readFontFamilies,
  scanFontDirectories,
  type FontDirectory,
} from "../../src/core/fonts/detect.js";

/**
 * The detector is driven against synthetic font files in a temp directory, never the host's real
 * font directories. A test that asserts on whichever fonts happen to be installed passes or
 * fails by accident of the machine it runs on.
 *
 * The fixtures are real sfnt byte layouts, not stubs: a header, a table directory, and a `name`
 * table with the records the parser actually reads. That is the point - a filename-derived
 * fake would exercise none of the parsing that makes `font check "Consolas"` work.
 */

/** UTF-16BE, which is what the Windows (platform 3) name records use. */
function utf16be(value: string): Buffer {
  const buffer = Buffer.from(value, "utf16le");
  buffer.swap16();
  return buffer;
}

interface NameRecord {
  platformID: number;
  nameID: number;
  value: string;
  /** Defaults to the platform's English: 0x0409 (en-US) on Windows, 0 on Mac. */
  languageID?: number;
}

function nameTable(records: NameRecord[]): Buffer {
  const encoded = records.map((record) => ({
    ...record,
    bytes: record.platformID === 1 ? Buffer.from(record.value, "latin1") : utf16be(record.value),
  }));
  const header = Buffer.alloc(6 + encoded.length * 12);
  header.writeUInt16BE(0, 0); // format 0
  header.writeUInt16BE(encoded.length, 2); // count
  header.writeUInt16BE(header.length, 4); // storage offset, relative to the table start

  let cursor = 0;
  const strings: Buffer[] = [];
  encoded.forEach((record, i) => {
    const base = 6 + i * 12;
    header.writeUInt16BE(record.platformID, base);
    header.writeUInt16BE(record.platformID === 1 ? 0 : 1, base + 2); // encodingID
    header.writeUInt16BE(
      record.languageID ?? (record.platformID === 1 ? 0 : 0x0409),
      base + 4, // languageID
    );
    header.writeUInt16BE(record.nameID, base + 6);
    header.writeUInt16BE(record.bytes.length, base + 8);
    header.writeUInt16BE(cursor, base + 10);
    strings.push(record.bytes);
    cursor += record.bytes.length;
  });
  return Buffer.concat([header, ...strings]);
}

/** A single-font sfnt file (`.ttf`/`.otf` share this container). */
function sfnt(tables: Record<string, Buffer>): Buffer {
  const tags = Object.keys(tables);
  const directorySize = 12 + tags.length * 16;
  const header = Buffer.alloc(directorySize);
  header.writeUInt32BE(0x00010000, 0); // sfntVersion
  header.writeUInt16BE(tags.length, 4);

  let offset = directorySize;
  const bodies: Buffer[] = [];
  tags.forEach((tag, i) => {
    const body = tables[tag] as Buffer;
    const base = 12 + i * 16;
    header.write(tag, base, "latin1");
    header.writeUInt32BE(0, base + 4); // checksum, unread
    header.writeUInt32BE(offset, base + 8);
    header.writeUInt32BE(body.length, base + 12);
    bodies.push(body);
    offset += body.length;
  });
  return Buffer.concat([header, ...bodies]);
}

function singleFamilyFont(family: string, records?: NameRecord[]): Buffer {
  return sfnt({
    // A second table the parser must skip over to reach `name`.
    head: Buffer.alloc(54),
    name: nameTable(records ?? [{ platformID: 3, nameID: 1, value: family }]),
  });
}

/** A `.ttc`/`.otc` collection: one shared file, one table directory per contained font. */
function fontCollection(families: string[]): Buffer {
  const header = Buffer.alloc(12 + families.length * 4);
  header.write("ttcf", 0, "latin1");
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt32BE(families.length, 8);

  const directorySize = 12 + 16; // one `name` table entry per font
  const directories: Buffer[] = [];
  const bodies: Buffer[] = [];
  let directoryOffset = header.length;
  let tableOffset = header.length + families.length * directorySize;

  families.forEach((family, i) => {
    header.writeUInt32BE(directoryOffset, 12 + i * 4);
    const table = nameTable([{ platformID: 3, nameID: 1, value: family }]);
    const directory = Buffer.alloc(directorySize);
    directory.writeUInt32BE(0x00010000, 0);
    directory.writeUInt16BE(1, 4); // numTables
    directory.write("name", 12, "latin1");
    directory.writeUInt32BE(0, 16); // checksum
    directory.writeUInt32BE(tableOffset, 20);
    directory.writeUInt32BE(table.length, 24);
    directories.push(directory);
    bodies.push(table);
    directoryOffset += directorySize;
    tableOffset += table.length;
  });
  return Buffer.concat([header, ...directories, ...bodies]);
}

describe("font detection against fixture directories", () => {
  let tmpRoot: string;
  let userDir: string;
  let machineDir: string;
  let directories: FontDirectory[];

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-fonts-"));
    userDir = path.join(tmpRoot, "user");
    machineDir = path.join(tmpRoot, "machine");
    fs.mkdirSync(userDir);
    fs.mkdirSync(machineDir);
    directories = [
      { dir: userDir, source: "user" },
      { dir: machineDir, source: "machine" },
    ];
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("reads family names from .ttf, .otf and .ttc files", () => {
    fs.writeFileSync(path.join(machineDir, "consola.ttf"), singleFamilyFont("Consolas"));
    fs.writeFileSync(path.join(machineDir, "FiraCode.otf"), singleFamilyFont("Fira Code"));
    fs.writeFileSync(
      path.join(machineDir, "cambria.ttc"),
      fontCollection(["Cambria", "Cambria Math"]),
    );

    expect(scanFontDirectories(directories).map((entry) => entry.family)).toEqual([
      "Cambria",
      "Cambria Math",
      "Consolas",
      "Fira Code",
    ]);
  });

  it("reads the family from the file's name table, not from its filename", () => {
    // The whole reason this module parses font files. Windows ships Consolas as `consola.ttf`;
    // a filename-derived detector reports the font a theme asks for as missing.
    fs.writeFileSync(path.join(machineDir, "consola.ttf"), singleFamilyFont("Consolas"));

    const families = scanFontDirectories(directories);

    expect(families).toHaveLength(1);
    expect(families[0]?.family).toBe("Consolas");
  });

  it("prefers the typographic family (name id 16) over the legacy family (id 1)", () => {
    // Patched and weighted builds put "JetBrainsMono NF Light" in id 1 and the family a user
    // would actually type in id 16.
    fs.writeFileSync(
      path.join(machineDir, "jetbrains.ttf"),
      singleFamilyFont("", [
        { platformID: 3, nameID: 1, value: "JetBrainsMono NF Light" },
        { platformID: 3, nameID: 16, value: "JetBrainsMono NF" },
      ]),
    );

    expect(scanFontDirectories(directories)[0]?.family).toBe("JetBrainsMono NF");
  });

  it("prefers the Windows name record over the Mac record for the same name id", () => {
    fs.writeFileSync(
      path.join(machineDir, "mixed.ttf"),
      singleFamilyFont("", [
        { platformID: 1, nameID: 1, value: "Mac Name" },
        { platformID: 3, nameID: 1, value: "Windows Name" },
      ]),
    );

    expect(scanFontDirectories(directories)[0]?.family).toBe("Windows Name");
  });

  it("prefers the en-US name record over a localized one that appears first", () => {
    // MingLiU and Microsoft JhengHei really do list their Chinese family name before the English
    // one, so taking the first Windows record reported `細明體_HKSCS-ExtB` as the installed
    // family. A theme's typography.family names the English family, so that is a false
    // "not installed" - the exact wrong answer this feature exists to prevent.
    fs.writeFileSync(
      path.join(machineDir, "mingliub.ttc"),
      sfnt({
        name: nameTable([
          { platformID: 3, nameID: 1, value: "細明體_HKSCS-ExtB", languageID: 0x0404 },
          { platformID: 3, nameID: 1, value: "MingLiU_HKSCS-ExtB", languageID: 0x0409 },
        ]),
      }),
    );

    expect(scanFontDirectories(directories)[0]?.family).toBe("MingLiU_HKSCS-ExtB");
  });

  it("ignores non-font files sitting in a font directory", () => {
    // Real %WINDIR%\Fonts contains desktop.ini, StaticCache.dat and hundreds of legacy .fon
    // raster fonts, none of which are sfnt containers.
    fs.writeFileSync(path.join(machineDir, "consola.ttf"), singleFamilyFont("Consolas"));
    fs.writeFileSync(path.join(machineDir, "desktop.ini"), "[.ShellClassInfo]\n");
    fs.writeFileSync(path.join(machineDir, "StaticCache.dat"), Buffer.alloc(64, 7));
    fs.writeFileSync(path.join(machineDir, "8514fix.fon"), Buffer.from("MZ not an sfnt"));

    expect(scanFontDirectories(directories).map((entry) => entry.family)).toEqual(["Consolas"]);
  });

  it("skips a file with a font extension that is not a readable font, without throwing", () => {
    fs.writeFileSync(path.join(machineDir, "truncated.ttf"), Buffer.from([0x00, 0x01]));
    fs.writeFileSync(path.join(machineDir, "garbage.otf"), Buffer.alloc(2048, 0xff));
    fs.writeFileSync(path.join(machineDir, "consola.ttf"), singleFamilyFont("Consolas"));

    expect(scanFontDirectories(directories).map((entry) => entry.family)).toEqual(["Consolas"]);
  });

  it("returns no families for an empty directory", () => {
    expect(scanFontDirectories(directories)).toEqual([]);
  });

  it("returns no families for a directory that does not exist", () => {
    expect(
      scanFontDirectories([{ dir: path.join(tmpRoot, "no-such-dir"), source: "machine" }]),
    ).toEqual([]);
  });

  it("reports a family installed in both directories once, tagged to the user copy", () => {
    // Windows resolves the per-user copy for the current account, and the user directory is
    // scanned first. Reporting it twice would also inflate the count `font list` prints.
    fs.writeFileSync(path.join(userDir, "CascadiaCode.ttf"), singleFamilyFont("Cascadia Code"));
    fs.writeFileSync(path.join(machineDir, "CascadiaCode.ttf"), singleFamilyFont("Cascadia Code"));

    const families = scanFontDirectories(directories);

    expect(families).toHaveLength(1);
    expect(families[0]).toMatchObject({ family: "Cascadia Code", source: "user" });
  });

  it("tags fonts with the directory they came from", () => {
    fs.writeFileSync(
      path.join(userDir, "UbuntuSansMono.ttf"),
      singleFamilyFont("Ubuntu Sans Mono"),
    );
    fs.writeFileSync(path.join(machineDir, "consola.ttf"), singleFamilyFont("Consolas"));

    expect(scanFontDirectories(directories)).toEqual([
      { family: "Consolas", source: "machine", nerdFont: false },
      { family: "Ubuntu Sans Mono", source: "user", nerdFont: false },
    ]);
  });

  it("returns an empty list for a file that is not a font at all", () => {
    const notAFont = path.join(tmpRoot, "notes.txt");
    fs.writeFileSync(notAFont, "hello");
    expect(readFontFamilies(notAFont)).toEqual([]);
    expect(readFontFamilies(path.join(tmpRoot, "missing.ttf"))).toEqual([]);
  });
});

describe("isProbableNerdFont (name-based heuristic)", () => {
  it.each([
    "JetBrainsMono Nerd Font",
    "FiraCode Nerd Font Mono",
    "CaskaydiaCove Nerd Font Propo",
    "hack nerd font",
    "Hack NF",
    "JetBrainsMono NFM",
    "CaskaydiaCove NFP",
  ])("flags %j", (family) => {
    expect(isProbableNerdFont(family)).toBe(true);
  });

  // Near misses. The heuristic is a substring match on a name, so the only thing stopping it
  // from flagging every family containing the letters n-f is the word boundary - and these pin
  // that down rather than assuming it. Without \b, "Infinity" and "Franklin Gothic Demi Cond"
  // (both really installed on Windows) would be reported as Nerd Fonts.
  it.each([
    "Infinity Sans",
    "Franklin Gothic Medium Cond",
    "Comfortaa",
    "Confident Script",
    "Sunflower Display",
    "NFS Mono Nerd",
    "Consolas",
    "Cascadia Code",
    "Cascadia Mono",
  ])("does not flag %j", (family) => {
    expect(isProbableNerdFont(family)).toBe(false);
  });

  it("does not flag the unpatched upstream family of a Nerd Font", () => {
    // "JetBrains Mono" installed is not "JetBrainsMono Nerd Font" installed; conflating them
    // would be exactly the glyph-level claim this heuristic must not make.
    expect(isProbableNerdFont("JetBrains Mono")).toBe(false);
    expect(isProbableNerdFont("JetBrainsMono Nerd Font")).toBe(true);
  });
});

/**
 * Platform branch. node:os is mocked and the module re-imported, following the technique in
 * tests/unit/capabilities.test.ts. Every case asserts the reported `platform` first: if the mock
 * stops being applied, the module reports the real host ("win32") and an "unsupported"
 * assertion would otherwise pass for the wrong reason.
 */
async function detectAs(platform: NodeJS.Platform) {
  vi.resetModules();
  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    const patched = { ...actual, platform: () => platform };
    return { ...patched, default: patched };
  });
  return import("../../src/core/fonts/detect.js");
}

describe("platform support signal", () => {
  afterEach(() => {
    vi.doUnmock("node:os");
    vi.resetModules();
  });

  it.each(["linux", "darwin", "freebsd"] as const)(
    "reports unsupported rather than an empty success on %s",
    async (platform) => {
      const { detectInstalledFonts, findInstalledFont, fontDirectories } = await detectAs(platform);

      const scan = detectInstalledFonts();
      expect(scan.platform).toBe(platform);
      expect(scan.support).toBe("unsupported");
      expect(scan.families).toEqual([]);
      expect(scan.directories).toEqual([]);
      expect(fontDirectories()).toEqual([]);

      const lookup = findInstalledFont("Consolas");
      expect(lookup.platform).toBe(platform);
      expect(lookup.support).toBe("unsupported");
      expect(lookup.match).toBeUndefined();
    },
  );

  it("reports unknown, not unsupported, on win32 with no locatable font directory", async () => {
    // Same distinction capability detection draws for Windows Terminal: "unsupported" tells the
    // user to give up, "unknown" says NIGHTSHIFT could not look.
    const original = { windir: process.env.WINDIR, localAppData: process.env.LOCALAPPDATA };
    delete process.env.WINDIR;
    delete process.env.LOCALAPPDATA;
    try {
      const { detectInstalledFonts, findInstalledFont } = await detectAs("win32");

      const scan = detectInstalledFonts();
      expect(scan.platform).toBe("win32");
      expect(scan.support).toBe("unknown");
      expect(scan.families).toEqual([]);
      expect(findInstalledFont("Consolas").support).toBe("unknown");
    } finally {
      if (original.windir === undefined) delete process.env.WINDIR;
      else process.env.WINDIR = original.windir;
      if (original.localAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = original.localAppData;
    }
  });

  it("builds the two documented Windows font directories, user first", async () => {
    const original = { windir: process.env.WINDIR, localAppData: process.env.LOCALAPPDATA };
    process.env.WINDIR = path.join("C:", "FakeWindows");
    process.env.LOCALAPPDATA = path.join("C:", "FakeLocalAppData");
    try {
      const { fontDirectories } = await detectAs("win32");

      expect(fontDirectories()).toEqual([
        {
          dir: path.join("C:", "FakeLocalAppData", "Microsoft", "Windows", "Fonts"),
          source: "user",
        },
        { dir: path.join("C:", "FakeWindows", "Fonts"), source: "machine" },
      ]);
    } finally {
      if (original.windir === undefined) delete process.env.WINDIR;
      else process.env.WINDIR = original.windir;
      if (original.localAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = original.localAppData;
    }
  });

  it("finds a family case-insensitively and with surrounding whitespace", async () => {
    // Drives findInstalledFont()'s own matching (early-exit path) against a fixture directory
    // rather than the host, by pointing WINDIR at a temp tree.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-fontfind-"));
    fs.mkdirSync(path.join(tmp, "Fonts"));
    fs.writeFileSync(path.join(tmp, "Fonts", "consola.ttf"), singleFamilyFont("Consolas"));
    const original = { windir: process.env.WINDIR, localAppData: process.env.LOCALAPPDATA };
    process.env.WINDIR = tmp;
    delete process.env.LOCALAPPDATA;
    try {
      const { findInstalledFont } = await detectAs("win32");

      expect(findInstalledFont("  consolas ").match).toMatchObject({
        family: "Consolas",
        source: "machine",
      });
      expect(findInstalledFont("Cascadia Code")).toMatchObject({
        support: "supported",
        match: undefined,
      });
    } finally {
      if (original.windir === undefined) delete process.env.WINDIR;
      else process.env.WINDIR = original.windir;
      if (original.localAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = original.localAppData;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
