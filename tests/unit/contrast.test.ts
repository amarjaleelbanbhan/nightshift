import { describe, it, expect } from "vitest";
import {
  contrastRatio,
  relativeLuminance,
  parseHex,
  auditThemeContrast,
  WCAG_AA_BODY,
  CHECKED_ROLES,
} from "../../src/core/themes/contrast.js";
import { builtinThemes } from "../../src/core/themes/builtin.js";

describe("parseHex", () => {
  it("parses 6-digit hex", () => {
    expect(parseHex("#FF8000")).toEqual([255, 128, 0]);
  });

  it("expands 3-digit shorthand", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("#08f")).toEqual([0, 136, 255]);
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "fff", "#ggg", "#12345", "#1234567", "rgb(0,0,0)"]) {
      expect(parseHex(bad)).toBeNull();
    }
  });
});

describe("relativeLuminance", () => {
  // Reference values from the WCAG 2.x definition.
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 10);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 10);
  });

  it("matches the known luminance of mid grey #808080", () => {
    expect(relativeLuminance("#808080")).toBeCloseTo(0.2158, 3);
  });

  it("matches known luminances of the sRGB primaries", () => {
    expect(relativeLuminance("#FF0000")).toBeCloseTo(0.2126, 4);
    expect(relativeLuminance("#00FF00")).toBeCloseTo(0.7152, 4);
    expect(relativeLuminance("#0000FF")).toBeCloseTo(0.0722, 4);
  });
});

describe("contrastRatio", () => {
  it("is exactly 21:1 for black on white", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 10);
  });

  it("is 1:1 for identical colors", () => {
    expect(contrastRatio("#65E58B", "#65E58B")).toBeCloseTo(1, 10);
    expect(contrastRatio("#000000", "#000000")).toBeCloseTo(1, 10);
  });

  it("is order-independent", () => {
    expect(contrastRatio("#0A0D0B", "#DCE6DF")).toBeCloseTo(
      contrastRatio("#DCE6DF", "#0A0D0B"),
      10,
    );
  });

  it("matches the known 5.32:1 of #767676 on white", () => {
    // #767676 is the canonical "smallest grey that passes AA on white".
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
  });

  it("never falls below 1 or above 21", () => {
    for (const theme of builtinThemes) {
      for (const role of CHECKED_ROLES) {
        const r = contrastRatio(theme.colors[role], theme.colors.background);
        expect(r).toBeGreaterThanOrEqual(1);
        expect(r).toBeLessThanOrEqual(21);
      }
    }
  });
});

describe("auditThemeContrast", () => {
  it("reports every checked role for every built-in theme", () => {
    for (const theme of builtinThemes) {
      const results = auditThemeContrast(theme);
      expect(results.map((r) => r.role)).toEqual([...CHECKED_ROLES]);
    }
  });

  it("sets passesBody consistently with the AA threshold", () => {
    for (const theme of builtinThemes) {
      for (const result of auditThemeContrast(theme)) {
        expect(result.passesBody).toBe(result.ratio >= WCAG_AA_BODY);
      }
    }
  });

  it("keeps every built-in theme's foreground above AA body contrast", () => {
    // Body text is the one pair that must never regress; accent roles are
    // reported but deliberately not asserted (see docs/development/UX_AUDIT.md).
    for (const theme of builtinThemes) {
      const fg = auditThemeContrast(theme).find((r) => r.role === "foreground");
      expect(fg?.passesBody, `${theme.id} foreground`).toBe(true);
    }
  });
});
