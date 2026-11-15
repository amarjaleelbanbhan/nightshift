import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  mergeThemeIntoSettings,
  readWindowsTerminalSettings,
} from "../../src/adapters/windows-terminal/apply.js";
import { builtinThemes } from "../../src/core/themes/builtin.js";

/**
 * Second hostile-shape suite for the Windows Terminal adapter, covering the shapes
 * `tests/unit/windows-terminal-apply.test.ts` does not: the `profiles` container itself
 * (G25) and the parse step in `readWindowsTerminalSettings`.
 *
 * G25 is the anchor: Windows Terminal's legacy settings format put `profiles` at the root as
 * a JSON **array**. Spreading an array into an object turns `[a, b]` into `{"0": a, "1": b}`,
 * which Windows Terminal cannot read - so the one operation this product exists to perform
 * safely silently destroyed the user's entire profile list and reported success.
 */

const ghostProtocol = builtinThemes.find((t) => t.id === "ghost-protocol")!;

describe("mergeThemeIntoSettings - the profiles container", () => {
  it("refuses a legacy array `profiles` instead of mangling it into numeric keys (G25)", () => {
    const legacy = {
      globals: { defaultProfile: "{guid-1}" },
      profiles: [
        { guid: "{guid-1}", name: "PowerShell", commandline: "pwsh.exe" },
        { guid: "{guid-2}", name: "cmd", commandline: "cmd.exe" },
      ],
    };
    expect(() => mergeThemeIntoSettings(legacy, ghostProtocol)).toThrow(/legacy/i);
    expect(() => mergeThemeIntoSettings(legacy, ghostProtocol)).toThrow(/"profiles"/);
    // The input object must be left untouched - the caller still has to write it back out.
    expect(Array.isArray(legacy.profiles)).toBe(true);
    expect(legacy.profiles).toHaveLength(2);
  });

  it.each([
    ["a string", "Campbell"],
    ["a number", 42],
    ["a boolean", true],
    ["null", null],
  ])("refuses a `profiles` that is %s rather than discarding it", (_label, value) => {
    expect(() => mergeThemeIntoSettings({ profiles: value }, ghostProtocol)).toThrow(/"profiles"/);
  });

  it("still merges normally when `profiles` is absent entirely", () => {
    const merged = mergeThemeIntoSettings({ copyOnSelect: true }, ghostProtocol);
    const profiles = merged.profiles as Record<string, unknown>;
    expect((profiles.defaults as Record<string, unknown>).colorScheme).toBe(ghostProtocol.name);
  });

  it("refuses an array `profiles.defaults` instead of mangling it into numeric keys", () => {
    const settings = { profiles: { defaults: [1, 2], list: [{ name: "a" }] } };
    expect(() => mergeThemeIntoSettings(settings, ghostProtocol)).toThrow(/profiles\.defaults/);
  });

  it.each([
    ["a string", "Campbell"],
    ["a number", 7],
    ["null", null],
  ])("refuses a `profiles.defaults` that is %s rather than discarding it", (_label, value) => {
    const settings = { profiles: { defaults: value, list: [{ name: "a" }] } };
    expect(() => mergeThemeIntoSettings(settings, ghostProtocol)).toThrow(/profiles\.defaults/);
  });

  it("refuses a non-object `profiles.defaults.font` rather than spreading it", () => {
    const settings = { profiles: { defaults: { font: "Cascadia Code" } } };
    expect(() => mergeThemeIntoSettings(settings, ghostProtocol)).toThrow(
      /profiles\.defaults\.font/,
    );
  });

  it("leaves `profiles.list` alone whatever shape it has, since it is never spread", () => {
    const settings = { profiles: { list: { notAnArray: true }, defaults: {} } };
    const merged = mergeThemeIntoSettings(settings, ghostProtocol);
    expect((merged.profiles as Record<string, unknown>).list).toEqual({ notAnArray: true });
  });

  it("keeps schemes whose names differ only in case, since Windows Terminal matches exactly", () => {
    const settings = {
      schemes: [{ name: "ghost protocol" }, { name: "GHOST PROTOCOL" }],
    };
    const merged = mergeThemeIntoSettings(settings, ghostProtocol);
    const schemes = merged.schemes as Array<{ name: string }>;
    expect(schemes.map((s) => s.name)).toEqual([
      "ghost protocol",
      "GHOST PROTOCOL",
      ghostProtocol.name,
    ]);
  });
});

describe("readWindowsTerminalSettings", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function write(content: string): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-wt-read-"));
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, content);
    return file;
  }

  it("parses a settings.json that starts with a UTF-8 BOM", () => {
    // Notepad writes "UTF-8 with BOM"; JSON.parse rejects the BOM outright.
    const file = write('﻿{"copyOnSelect": true}');
    expect(readWindowsTerminalSettings(file)).toEqual({ copyOnSelect: true });
  });

  it("parses a settings.json with CRLF line endings", () => {
    const file = write('{\r\n    "copyOnSelect": true\r\n}\r\n');
    expect(readWindowsTerminalSettings(file)).toEqual({ copyOnSelect: true });
  });

  it("names the file and the remedy for an empty settings.json", () => {
    const file = write("");
    expect(() => readWindowsTerminalSettings(file)).toThrow(new RegExp(/is not valid JSON/));
    expect(() => readWindowsTerminalSettings(file)).toThrow(
      new RegExp(file.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")),
    );
  });

  it("explains a JSONC settings.json rather than reporting a raw syntax error", () => {
    // Windows Terminal documents settings.json as JSONC and its own generated file has
    // carried a `//` comment header. NIGHTSHIFT writes with JSON.stringify, which cannot
    // preserve comments, so it must say so instead of printing "Unexpected token '/'".
    const file = write('// This file was initially generated by Windows Terminal\n{"a": 1}');
    expect(() => readWindowsTerminalSettings(file)).toThrow(/comment/i);
  });

  it("does not mistake a URL inside a string value for a comment", () => {
    const file = write('{\n  "$help": "https://aka.ms/terminal-documentation",\n');
    expect(() => readWindowsTerminalSettings(file)).toThrow(/is not valid JSON/);
    expect(() => readWindowsTerminalSettings(file)).not.toThrow(/comment/i);
  });

  it("still rejects a JSON array at the root", () => {
    const file = write("[1, 2, 3]");
    expect(() => readWindowsTerminalSettings(file)).toThrow(/does not contain a JSON object/);
  });
});
