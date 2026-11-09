import { describe, it, expect } from "vitest";
import { safeParseProfile } from "../../src/core/profiles/schema.js";

describe("profile schema", () => {
  it("accepts a valid profile", () => {
    const result = safeParseProfile({
      id: "ghost-protocol-default",
      schemaVersion: "1.0",
      name: "Ghost Protocol (Default)",
      themeId: "ghost-protocol",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unexpected field shape", () => {
    const result = safeParseProfile({
      id: "bad",
      schemaVersion: "1.0",
      name: "Bad",
      themeId: 42,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing themeId", () => {
    const result = safeParseProfile({
      id: "bad",
      schemaVersion: "1.0",
      name: "Bad",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unexpected extra property instead of silently dropping it", () => {
    const result = safeParseProfile({
      id: "sneaky",
      schemaVersion: "1.0",
      name: "Sneaky",
      themeId: "ghost-protocol",
      widgets: ["something-not-yet-supported"],
    });
    expect(result.success).toBe(false);
  });
});
