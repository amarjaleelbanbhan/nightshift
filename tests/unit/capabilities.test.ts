import { describe, it, expect } from "vitest";
import { detectCapabilities } from "../../src/core/capabilities/detect.js";

describe("detectCapabilities", () => {
  it("reports the current platform and a defined support level", () => {
    const caps = detectCapabilities();
    expect(caps.platform).toBe(process.platform);
    expect(["supported", "partial", "unsupported", "unknown"]).toContain(
      caps.windowsTerminal.support,
    );
    expect(["supported", "partial", "unsupported", "unknown"]).toContain(
      caps.claudeCode.support,
    );
  });

  it("never claims a platform is supported without evidence", () => {
    const caps = detectCapabilities();
    if (caps.platform !== "win32") {
      expect(caps.platformSupport).toBe("unsupported");
    }
  });
});
