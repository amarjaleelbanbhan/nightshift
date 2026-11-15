import { describe, it, expect } from "vitest";
import { mergeThemeIntoSettings } from "../../src/adapters/windows-terminal/apply.js";
import { builtinThemes } from "../../src/core/themes/builtin.js";

const ghostProtocol = builtinThemes.find((t) => t.id === "ghost-protocol")!;

describe("mergeThemeIntoSettings", () => {
  it("preserves unrelated top-level keys", () => {
    const settings = {
      $help: "https://aka.ms/terminal-documentation",
      defaultProfile: "{some-guid}",
      copyOnSelect: true,
    };
    const merged = mergeThemeIntoSettings(settings, ghostProtocol);
    expect(merged.$help).toBe(settings.$help);
    expect(merged.defaultProfile).toBe(settings.defaultProfile);
    expect(merged.copyOnSelect).toBe(true);
  });

  it("preserves existing unrelated profile defaults keys", () => {
    const settings = {
      profiles: { defaults: { useAcrylic: true }, list: [{ name: "PowerShell" }] },
    };
    const merged = mergeThemeIntoSettings(settings, ghostProtocol);
    const defaults = (merged.profiles as Record<string, unknown>).defaults as Record<
      string,
      unknown
    >;
    expect(defaults.useAcrylic).toBe(true);
    expect(defaults.colorScheme).toBe(ghostProtocol.name);
    expect((merged.profiles as Record<string, unknown>).list as unknown[]).toHaveLength(1);
  });

  it("replaces an existing scheme with the same name instead of duplicating it", () => {
    const settings = {
      schemes: [{ name: ghostProtocol.name, background: "#000000" }],
    };
    const merged = mergeThemeIntoSettings(settings, ghostProtocol);
    const schemes = merged.schemes as Array<{ name: string; background: string }>;
    expect(schemes).toHaveLength(1);
    expect(schemes[0]!.background).toBe(ghostProtocol.colors.background);
  });

  it("adds a new scheme without touching other named schemes", () => {
    const settings = { schemes: [{ name: "Campbell", background: "#0C0C0C" }] };
    const merged = mergeThemeIntoSettings(settings, ghostProtocol);
    const schemes = merged.schemes as Array<{ name: string }>;
    expect(schemes).toHaveLength(2);
    expect(schemes.some((s) => s.name === "Campbell")).toBe(true);
    expect(schemes.some((s) => s.name === ghostProtocol.name)).toBe(true);
  });

  // G7: settings.schemes used to be cast straight to WindowsTerminalColorScheme[] and
  // filtered on `s?.name`, so nothing checked that the elements were objects at all.
  describe("hostile or malformed settings.json shapes", () => {
    it.each([
      ["null", null],
      ["a string", "Campbell"],
      ["a number", 42],
      ["an object", { Campbell: {} }],
      ["a boolean", true],
    ])("treats a non-array schemes (%s) as empty instead of crashing", (_label, value) => {
      const merged = mergeThemeIntoSettings({ schemes: value }, ghostProtocol);
      const schemes = merged.schemes as unknown[];
      expect(schemes).toHaveLength(1);
      expect((schemes[0] as { name: string }).name).toBe(ghostProtocol.name);
    });

    it("does not read .name off non-object scheme elements, and keeps them", () => {
      const settings = { schemes: [null, "Campbell", 42, [], undefined, { nested: {} }] };
      const merged = mergeThemeIntoSettings(settings, ghostProtocol);
      const schemes = merged.schemes as unknown[];
      // All 6 junk elements preserved (NIGHTSHIFT never deletes data it does not
      // understand), plus the applied scheme appended.
      expect(schemes).toHaveLength(7);
      expect(schemes.slice(0, 6)).toEqual([null, "Campbell", 42, [], undefined, { nested: {} }]);
      expect((schemes[6] as { name: string }).name).toBe(ghostProtocol.name);
    });

    it("still deduplicates the real scheme when junk elements sit beside it", () => {
      const settings = {
        schemes: [null, { name: ghostProtocol.name, background: "#000000" }, "junk"],
      };
      const merged = mergeThemeIntoSettings(settings, ghostProtocol);
      const schemes = merged.schemes as unknown[];
      expect(schemes).toHaveLength(3); // null + "junk" + the single replaced scheme
      const named = schemes.filter(
        (s) =>
          typeof s === "object" &&
          s !== null &&
          (s as { name?: unknown }).name === ghostProtocol.name,
      );
      expect(named).toHaveLength(1);
      expect((named[0] as { background: string }).background).toBe(ghostProtocol.colors.background);
    });

    it("does not match a scheme whose name is a non-string look-alike", () => {
      // An element carrying a non-string `name` must not be treated as the same scheme.
      const settings = { schemes: [{ name: ["Ghost Protocol"] }] };
      const merged = mergeThemeIntoSettings(settings, ghostProtocol);
      expect(merged.schemes as unknown[]).toHaveLength(2);
    });
  });
});
