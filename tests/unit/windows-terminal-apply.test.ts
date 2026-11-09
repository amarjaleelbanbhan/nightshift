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
    expect(((merged.profiles as Record<string, unknown>).list as unknown[])).toHaveLength(1);
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
});
