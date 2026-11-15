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

  it.each([
    ["an array", [1, 2]],
    ["null", null],
    ["a number", 14],
    ["a boolean", false],
  ])("refuses a `profiles.defaults.font` that is %s rather than spreading it", (_label, value) => {
    const settings = { profiles: { defaults: { font: value } } };
    expect(() => mergeThemeIntoSettings(settings, ghostProtocol)).toThrow(
      /profiles\.defaults\.font/,
    );
  });

  it("replaces an existing colorScheme rather than leaving the old name in place", () => {
    const settings = { profiles: { defaults: { colorScheme: "Campbell", useAcrylic: true } } };
    const defaults = (
      mergeThemeIntoSettings(settings, ghostProtocol).profiles as Record<string, unknown>
    ).defaults as Record<string, unknown>;
    expect(defaults.colorScheme).toBe(ghostProtocol.name);
    expect(defaults.useAcrylic).toBe(true);
  });

  it("leaves `profiles.defaults.font` entirely alone for a theme with no typography", () => {
    // Only user themes can lack `typography` - all four built-ins declare it - so this branch
    // is reachable only from a hand-written theme file. Wiping the font face someone chose in
    // Windows Terminal's own settings UI because their theme is silent about fonts would be a
    // destructive surprise, and `font` is the one key here that is not ours to touch.
    const noTypography = { ...ghostProtocol };
    delete (noTypography as { typography?: unknown }).typography;
    const settings = {
      profiles: { defaults: { font: { face: "Consolas", size: 11, weight: "normal" } } },
    };

    const defaults = (
      mergeThemeIntoSettings(settings, noTypography).profiles as Record<string, unknown>
    ).defaults as Record<string, unknown>;

    expect(defaults.font).toEqual({ face: "Consolas", size: 11, weight: "normal" });
    expect(defaults.colorScheme).toBe(ghostProtocol.name);
  });

  it("does not invent a `font` key when neither the theme nor the settings have one", () => {
    const noTypography = { ...ghostProtocol };
    delete (noTypography as { typography?: unknown }).typography;
    const defaults = (mergeThemeIntoSettings({}, noTypography).profiles as Record<string, unknown>)
      .defaults as Record<string, unknown>;
    expect("font" in defaults).toBe(false);
  });

  /**
   * settings.json is parsed with `JSON.parse` and then object-spread three times over
   * (`settings`, `profiles`, `profiles.defaults`). `JSON.parse` makes `__proto__` an *own* data
   * property and spread copies own properties with `CreateDataProperty`, which does not run the
   * `__proto__` setter - so this is safe today. It is asserted rather than assumed because the
   * safety is a property of the spread operator, not of anything visible in this module: an
   * innocent-looking refactor to `Object.assign({}, settings)` keeps every other test in this
   * file green while reintroducing the hole.
   */
  describe("prototype-polluting keys in settings.json", () => {
    afterEach(() => {
      delete (Object.prototype as Record<string, unknown>).polluted;
    });

    const POISON = '{"polluted":true}';

    it.each([
      ["the root", `{"__proto__":${POISON},"copyOnSelect":true}`],
      ["profiles", `{"profiles":{"__proto__":${POISON},"list":[]}}`],
      ["profiles.defaults", `{"profiles":{"defaults":{"__proto__":${POISON}}}}`],
    ])("does not pollute Object.prototype via a `__proto__` key at %s", (_label, json) => {
      // Written as JSON text and parsed, not as an object literal: `{__proto__: x}` in source
      // *sets the prototype* and produces no own key at all, so a literal would test nothing.
      // JSON.parse is also how the real input arrives.
      const settings = JSON.parse(json) as Record<string, unknown>;
      // Guards against a vacuous pass: if `__proto__` were a prototype assignment rather than
      // an own key, it would not survive stringify and there would be nothing under test.
      expect(JSON.stringify(settings)).toContain('"__proto__"');

      const merged = mergeThemeIntoSettings(settings, ghostProtocol);

      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect((merged as Record<string, unknown>).polluted).toBeUndefined();
      // And the key survives: NIGHTSHIFT does not quietly delete data it does not understand,
      // even data this ugly.
      expect(JSON.stringify(merged)).toContain('"__proto__"');
    });
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

  it.each([
    ["null", "null"],
    ["a boolean", "true"],
    ["a number", "42"],
    ["a bare string", '"Campbell"'],
  ])("rejects a settings.json whose root is %s", (_label, content) => {
    // Each of these parses cleanly, so the only thing standing between them and
    // `mergeThemeIntoSettings` spreading a non-object is this root check. `null` in particular
    // passes a bare `typeof x === "object"` test.
    const file = write(content);
    expect(() => readWindowsTerminalSettings(file)).toThrow(/does not contain a JSON object/);
  });

  it("falls back to the generic message for a `/* */` block comment", () => {
    // The JSONC hint is deliberately `//`-only, because that is the form Windows Terminal's own
    // generated header uses and a `/*` test would have to tell a comment apart from a `/`
    // inside a string value. Pinned so the narrowness is a decision on record, not a surprise.
    const file = write('/* generated by Windows Terminal */\n{"a": 1}');
    expect(() => readWindowsTerminalSettings(file)).toThrow(/is not valid JSON/);
    expect(() => readWindowsTerminalSettings(file)).toThrow(/Fix the JSON syntax/);
  });
});
