import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// Type-only: erased at compile time, so this does not put the capability detector (or anything
// it imports) on the font path. Nothing in this module may pull in zod or boxen - a directory
// listing and a few header reads must not cost what `--version` used to.
import type { SupportLevel } from "../capabilities/detect.js";

/**
 * Which font families are actually installed.
 *
 * Why this parses font files instead of deriving names from filenames: the family a theme names
 * (`typography.family`, e.g. `"Consolas"`) is the *family* name, and Windows font filenames are
 * not it - `Consolas` ships as `consola.ttf`, `Cascadia Code` as `CascadiaCode.ttf`. Deriving
 * families from filenames reports installed fonts as missing, and a false "missing" in `doctor`
 * is the same kind of wrong answer as the silent substitution this whole feature exists to
 * name. The `name` table is the only place the real family name lives.
 *
 * The alternative sources were both ruled out: the font registry key
 * (`HKLM\...\CurrentVersion\Fonts`) needs `reg.exe`, and any Win32 call needs PowerShell -
 * shelling out is forbidden for this feature, and a new dependency is not on the table.
 *
 * Only `.ttf`/`.otf`/`.ttc`/`.otc` are read. `.fon` files (several hundred of them in
 * `%WINDIR%\Fonts`) are legacy raster fonts in an unrelated executable format; no theme can
 * request one as a terminal font face, so they are skipped rather than half-parsed.
 */

export type FontSource = "user" | "machine";

export interface FontFamily {
  family: string;
  source: FontSource;
  /**
   * Name-based heuristic. True means the family *name* looks like a Nerd Font patch; no glyph
   * coverage was inspected and none is claimed. Every surface that renders this must say so.
   */
  nerdFont: boolean;
}

export interface FontDirectory {
  dir: string;
  source: FontSource;
}

export interface FontScan {
  /** `supported` on Windows with at least one readable font directory, `unknown` on Windows
   * without one, `unsupported` everywhere else. Deliberately not an empty success: "no fonts
   * found" and "this platform was never looked at" are different claims. */
  support: SupportLevel;
  platform: NodeJS.Platform;
  /** The font directories that exist and were actually read. */
  directories: string[];
  families: FontFamily[];
}

export interface FontLookup {
  support: SupportLevel;
  platform: NodeJS.Platform;
  match: FontFamily | undefined;
}

const FONT_EXTENSIONS = new Set([".ttf", ".otf", ".ttc", ".otc"]);

/**
 * Nerd Font patched builds name themselves "<Family> Nerd Font", "... Nerd Font Mono/Propo", or
 * abbreviate to the "NF"/"NFM"/"NFP" token. Word boundaries matter: without them this matches
 * "Infinity" and every other family that merely contains the letters n-f.
 */
const NERD_FONT_NAME = /\bnerd font\b|\bnf[mp]?\b/i;

const NAME_ID_FAMILY = 1;
const NAME_ID_TYPOGRAPHIC_FAMILY = 16;
/** Caps on values read from the file itself, so a corrupt or hostile font cannot ask for a
 * gigabyte read or a four-billion-iteration loop. */
const MAX_TABLES = 512;
const MAX_FONTS_PER_COLLECTION = 64;
const MAX_NAME_TABLE_BYTES = 64 * 1024;

/** Name-based only - see `FontFamily.nerdFont`. */
export function isProbableNerdFont(family: string): boolean {
  return NERD_FONT_NAME.test(family);
}

/**
 * The per-user and machine-wide font directories, user first. Returns an empty list off Windows
 * or when the environment does not say where Windows lives; callers distinguish those two cases
 * via the platform, not via this list.
 */
export function fontDirectories(): FontDirectory[] {
  if (os.platform() !== "win32") return [];
  const directories: FontDirectory[] = [];
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    directories.push({
      dir: path.join(localAppData, "Microsoft", "Windows", "Fonts"),
      source: "user",
    });
  }
  const windir = process.env.WINDIR;
  if (windir) directories.push({ dir: path.join(windir, "Fonts"), source: "machine" });
  return directories;
}

function readExact(fd: number, offset: number, length: number): Buffer | null {
  if (offset < 0 || length <= 0) return null;
  const buffer = Buffer.alloc(length);
  const read = fs.readSync(fd, buffer, 0, length, offset);
  return read === length ? buffer : null;
}

function decodeNameRecord(slice: Buffer, platformID: number): string {
  // Platform 1 is Mac Roman, which is ASCII for every family name in practice. Everything else
  // (0 = Unicode, 3 = Windows) is UTF-16BE, and Node only decodes UTF-16LE.
  if (platformID === 1) return slice.toString("latin1");
  if (slice.length % 2 !== 0) return "";
  const swapped = Buffer.from(slice);
  swapped.swap16();
  return swapped.toString("utf16le");
}

const WINDOWS_LANGUAGE_EN_US = 0x0409;
const MAC_LANGUAGE_ENGLISH = 0;

/**
 * A `name` table carries the same name id once per platform *and per language*, so picking
 * records in file order is not enough. Preference order, highest first:
 *
 * 1. Windows platform, en-US. 2. Windows platform, any other language. 3. Mac platform,
 * English. 4. Anything else.
 *
 * The language rung is not cosmetic: fonts like MingLiU and Microsoft JhengHei list their
 * Chinese family name before the English one, so taking the first Windows record reported
 * `細明體_HKSCS-ExtB` as the installed family. A theme's `typography.family` names the English
 * family, so that would be a false "not installed" - the exact wrong answer this feature exists
 * to prevent.
 */
function recordPriority(platformID: number, languageID: number): number {
  const english =
    platformID === 3 ? languageID === WINDOWS_LANGUAGE_EN_US : languageID === MAC_LANGUAGE_ENGLISH;
  return (platformID === 3 ? 2 : 0) + (english ? 1 : 0);
}

/** The family name from an sfnt `name` table: typographic family (id 16) if present, else the
 * legacy family (id 1), taking the highest-priority record of each. */
function parseNameTable(table: Buffer): string | null {
  if (table.length < 6) return null;
  const count = table.readUInt16BE(2);
  const stringOffset = table.readUInt16BE(4);
  const best = new Map<number, { value: string; priority: number }>();

  for (let i = 0; i < count; i++) {
    const record = 6 + i * 12;
    if (record + 12 > table.length) break;
    const platformID = table.readUInt16BE(record);
    const languageID = table.readUInt16BE(record + 4);
    const nameID = table.readUInt16BE(record + 6);
    if (nameID !== NAME_ID_FAMILY && nameID !== NAME_ID_TYPOGRAPHIC_FAMILY) continue;

    const length = table.readUInt16BE(record + 8);
    const offset = stringOffset + table.readUInt16BE(record + 10);
    if (length === 0 || offset + length > table.length) continue;

    const value = decodeNameRecord(table.subarray(offset, offset + length), platformID).trim();
    if (!value) continue;
    const priority = recordPriority(platformID, languageID);
    const existing = best.get(nameID);
    if (!existing || priority > existing.priority) best.set(nameID, { value, priority });
  }

  return best.get(NAME_ID_TYPOGRAPHIC_FAMILY)?.value ?? best.get(NAME_ID_FAMILY)?.value ?? null;
}

function familyAtDirectory(fd: number, directoryOffset: number): string | null {
  const header = readExact(fd, directoryOffset, 12);
  if (!header) return null;
  const numTables = header.readUInt16BE(4);
  if (numTables === 0 || numTables > MAX_TABLES) return null;
  const directory = readExact(fd, directoryOffset + 12, numTables * 16);
  if (!directory) return null;

  for (let i = 0; i < numTables; i++) {
    const base = i * 16;
    if (directory.toString("latin1", base, base + 4) !== "name") continue;
    const offset = directory.readUInt32BE(base + 8);
    const length = directory.readUInt32BE(base + 12);
    if (length < 6) return null;
    const table = readExact(fd, offset, Math.min(length, MAX_NAME_TABLE_BYTES));
    return table ? parseNameTable(table) : null;
  }
  return null;
}

/**
 * Every family name declared by one font file. Usually one; a `.ttc`/`.otc` collection declares
 * one per contained font. Returns `[]` for anything unreadable or not actually a font, so a
 * stray file in a font directory is skipped rather than fatal.
 *
 * Reads only the header, the table directory and the `name` table - never the whole file.
 * `%WINDIR%\Fonts` is hundreds of megabytes.
 */
export function readFontFamilies(file: string): string[] {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return [];
  }
  try {
    const tag = readExact(fd, 0, 4);
    if (!tag) return [];
    if (tag.toString("latin1") !== "ttcf") {
      const family = familyAtDirectory(fd, 0);
      return family ? [family] : [];
    }

    const collection = readExact(fd, 8, 4);
    if (!collection) return [];
    const numFonts = Math.min(collection.readUInt32BE(0), MAX_FONTS_PER_COLLECTION);
    const families: string[] = [];
    for (let i = 0; i < numFonts; i++) {
      const entry = readExact(fd, 12 + i * 4, 4);
      if (!entry) break;
      const family = familyAtDirectory(fd, entry.readUInt32BE(0));
      if (family) families.push(family);
    }
    return families;
  } catch {
    return [];
  } finally {
    fs.closeSync(fd);
  }
}

function* iterateFamilies(directories: FontDirectory[]): Generator<FontFamily> {
  for (const { dir, source } of directories) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir).sort();
    } catch {
      continue; // A font directory that does not exist is not an error; it just has no fonts.
    }
    for (const entry of entries) {
      if (!FONT_EXTENSIONS.has(path.extname(entry).toLowerCase())) continue;
      for (const family of readFontFamilies(path.join(dir, entry))) {
        yield { family, source, nerdFont: isProbableNerdFont(family) };
      }
    }
  }
}

/**
 * Deduplicated families from the given directories, sorted by family name. Exported so tests can
 * drive a fixture directory instead of whatever fonts happen to be installed on the host.
 *
 * A family present in both directories is reported once, tagged with the first directory it was
 * found in. Callers pass the user directory first, which is the copy Windows resolves for the
 * current account.
 */
export function scanFontDirectories(directories: FontDirectory[]): FontFamily[] {
  const byFamily = new Map<string, FontFamily>();
  for (const entry of iterateFamilies(directories)) {
    const key = entry.family.toLowerCase();
    if (!byFamily.has(key)) byFamily.set(key, entry);
  }
  return [...byFamily.values()].sort((a, b) => a.family.localeCompare(b.family));
}

function existingDirectories(): FontDirectory[] {
  return fontDirectories().filter((entry) => fs.existsSync(entry.dir));
}

export function detectInstalledFonts(): FontScan {
  const platform = os.platform();
  if (platform !== "win32") {
    return { support: "unsupported", platform, directories: [], families: [] };
  }
  const directories = existingDirectories();
  if (directories.length === 0) {
    return { support: "unknown", platform, directories: [], families: [] };
  }
  return {
    support: "supported",
    platform,
    directories: directories.map((entry) => entry.dir),
    families: scanFontDirectories(directories),
  };
}

/**
 * Whether one family is installed, case-insensitively.
 *
 * Separate from `detectInstalledFonts()` because it stops at the first match instead of parsing
 * every font file - which is what keeps `doctor` and `font check` cheap in the common case where
 * the theme's font *is* installed.
 */
export function findInstalledFont(family: string): FontLookup {
  const platform = os.platform();
  if (platform !== "win32") return { support: "unsupported", platform, match: undefined };
  const directories = existingDirectories();
  if (directories.length === 0) return { support: "unknown", platform, match: undefined };

  const target = family.trim().toLowerCase();
  for (const entry of iterateFamilies(directories)) {
    if (entry.family.toLowerCase() === target) {
      return { support: "supported", platform, match: entry };
    }
  }
  return { support: "supported", platform, match: undefined };
}
