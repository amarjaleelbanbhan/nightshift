import { describe, it, expect } from "vitest";
import { safeParseTheme } from "../../src/core/themes/schema.js";
import { builtinThemes } from "../../src/core/themes/builtin.js";

describe("theme schema", () => {
  it("accepts every built-in theme", () => {
    for (const theme of builtinThemes) {
      const result = safeParseTheme(theme);
      expect(result.success).toBe(true);
    }
  });

  it("rejects a non-hex color", () => {
    const bad = structuredClone(builtinThemes[0]);
    bad.colors.background = "not-a-color";
    expect(safeParseTheme(bad).success).toBe(false);
  });

  it("rejects an id with invalid characters", () => {
    const bad = structuredClone(builtinThemes[0]);
    bad.id = "Ghost Protocol!";
    expect(safeParseTheme(bad).success).toBe(false);
  });

  it("rejects an unexpected schema version", () => {
    const bad = { ...structuredClone(builtinThemes[0]), schemaVersion: "2.0" };
    expect(safeParseTheme(bad).success).toBe(false);
  });

  it("rejects a theme missing required ansi colors", () => {
    const bad = structuredClone(builtinThemes[0]) as Record<string, unknown>;
    delete (bad.ansi as Record<string, unknown>).brightWhite;
    expect(safeParseTheme(bad).success).toBe(false);
  });
});
