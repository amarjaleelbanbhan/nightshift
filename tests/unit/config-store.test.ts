import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  readConfig,
  writeConfig,
  setActiveTheme,
  setActiveProfileAndTheme,
} from "../../src/core/config/store.js";
import { getConfigFilePath } from "../../src/core/config/paths.js";

describe("config store", () => {
  let tmpRoot: string;
  let originalAppData: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-config-"));
    originalAppData = process.env.APPDATA;
    process.env.APPDATA = tmpRoot;
  });

  afterEach(() => {
    process.env.APPDATA = originalAppData;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("treats a 0.1.0 config file (no activeProfileId) as activeProfileId: null", () => {
    const legacyConfig = {
      schemaVersion: "1.0",
      activeThemeId: "ghost-protocol",
      initializedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(getConfigFilePath()), { recursive: true });
    fs.writeFileSync(getConfigFilePath(), JSON.stringify(legacyConfig));

    const config = readConfig();
    expect(config.activeThemeId).toBe("ghost-protocol");
    expect(config.activeProfileId).toBeNull();
  });

  it("clears activeProfileId when a theme is applied standalone", () => {
    writeConfig({
      schemaVersion: "1.0",
      activeThemeId: "monolith",
      activeProfileId: "some-profile",
      initializedAt: new Date().toISOString(),
    });

    setActiveTheme("ghost-protocol");

    const config = readConfig();
    expect(config.activeThemeId).toBe("ghost-protocol");
    expect(config.activeProfileId).toBeNull();
  });

  it("sets both active profile and theme atomically", () => {
    setActiveProfileAndTheme("ghost-protocol-default", "ghost-protocol");
    const config = readConfig();
    expect(config.activeProfileId).toBe("ghost-protocol-default");
    expect(config.activeThemeId).toBe("ghost-protocol");
  });
});
