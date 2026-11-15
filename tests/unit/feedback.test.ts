import { describe, it, expect } from "vitest";
import {
  errorMessage,
  emptyState,
  successMessage,
  warnMessage,
} from "../../src/cli/ui/feedback.js";
import { colorDisabledByRequest } from "../../src/cli/ui/color-mode.js";

// chalk disables itself under the test runner's piped stdout, so these assert on structure
// rather than on color. tests/integration/no-color.test.ts covers the ANSI behaviour against
// the real built binary with FORCE_COLOR set.

describe("feedback components", () => {
  it("marks state with a glyph so meaning does not depend on color alone", () => {
    expect(errorMessage("broke")).toContain("✗");
    expect(successMessage("worked")).toContain("✓");
    expect(warnMessage("careful")).toContain("!");
  });

  it("renders the hint on its own indented line with an arrow", () => {
    expect(errorMessage("broke", "do this")).toBe("✗ broke\n  → do this");
    expect(warnMessage("careful", "do this")).toBe("! careful\n  → do this");
    expect(emptyState("nothing here", "do this")).toBe("nothing here\n  → do this");
  });

  it("omits the hint line entirely when no hint is given", () => {
    expect(errorMessage("broke")).toBe("✗ broke");
    expect(emptyState("nothing here")).toBe("nothing here");
    expect(errorMessage("broke").split("\n")).toHaveLength(1);
  });

  it("keeps the caller's message verbatim", () => {
    const msg = 'No theme found with id "weird \\ id".';
    expect(errorMessage(msg)).toContain(msg);
  });
});

describe("colorDisabledByRequest", () => {
  it("is false by default", () => {
    expect(colorDisabledByRequest({}, ["node", "cli"])).toBe(false);
  });

  it("honours any non-empty NO_COLOR value, per no-color.org", () => {
    expect(colorDisabledByRequest({ NO_COLOR: "1" }, [])).toBe(true);
    expect(colorDisabledByRequest({ NO_COLOR: "0" }, [])).toBe(true);
    expect(colorDisabledByRequest({ NO_COLOR: "anything" }, [])).toBe(true);
  });

  it("ignores an empty NO_COLOR, per no-color.org", () => {
    expect(colorDisabledByRequest({ NO_COLOR: "" }, [])).toBe(false);
  });

  it("honours the --no-color flag", () => {
    expect(colorDisabledByRequest({}, ["node", "cli", "status", "--no-color"])).toBe(true);
  });

  it("overrides FORCE_COLOR, unlike chalk's own precedence", () => {
    expect(colorDisabledByRequest({ FORCE_COLOR: "3", NO_COLOR: "1" }, [])).toBe(true);
  });

  it("does not match a partial or similar flag", () => {
    expect(colorDisabledByRequest({}, ["--no-colors"])).toBe(false);
    expect(colorDisabledByRequest({}, ["--color"])).toBe(false);
  });
});
