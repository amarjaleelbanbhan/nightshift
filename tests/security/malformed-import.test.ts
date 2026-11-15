import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { listThemes } from "../../src/core/themes/registry.js";
import { getUserThemesDir, getConfigFilePath } from "../../src/core/config/paths.js";
import { readConfig } from "../../src/core/config/store.js";
import { MAX_JSON_FILE_BYTES, FileTooLargeError } from "../../src/security/limits.js";
import { builtinThemes } from "../../src/core/themes/builtin.js";

describe("malformed user theme imports", () => {
  let tmpRoot: string;
  let originalAppData: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-appdata-"));
    originalAppData = process.env.APPDATA;
    process.env.APPDATA = tmpRoot;
  });

  afterEach(() => {
    process.env.APPDATA = originalAppData;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("skips a theme file with invalid JSON instead of crashing", () => {
    const themesDir = getUserThemesDir();
    fs.mkdirSync(themesDir, { recursive: true });
    fs.writeFileSync(path.join(themesDir, "broken.json"), "{ not valid json");

    expect(() => listThemes()).not.toThrow();
    const ids = listThemes().map((e) => e.theme.id);
    expect(ids).not.toContain("broken");
  });

  it("skips a theme file with unexpected extra/missing fields", () => {
    const themesDir = getUserThemesDir();
    fs.mkdirSync(themesDir, { recursive: true });
    fs.writeFileSync(
      path.join(themesDir, "incomplete.json"),
      JSON.stringify({ id: "incomplete", schemaVersion: "1.0", name: "Incomplete" }),
    );

    const entries = listThemes();
    expect(entries.find((e) => e.theme.id === "incomplete")).toBeUndefined();
  });

  it("still returns all built-in themes when a user theme is malformed", () => {
    const themesDir = getUserThemesDir();
    fs.mkdirSync(themesDir, { recursive: true });
    fs.writeFileSync(path.join(themesDir, "broken.json"), "not json at all");

    const entries = listThemes();
    const builtinCount = entries.filter((e) => e.source === "builtin").length;
    expect(builtinCount).toBe(4);
  });
});

// G9: before this guard, profile import was the only read with a size cap, so a
// multi-gigabyte themes/*.json or config.json was read into memory unconditionally.
describe("oversized file resource-exhaustion guard", () => {
  let tmpRoot: string;
  let originalAppData: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-appdata-"));
    originalAppData = process.env.APPDATA;
    process.env.APPDATA = tmpRoot;
  });

  afterEach(() => {
    process.env.APPDATA = originalAppData;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  /** A *schema-valid* theme padded past the cap, so only the size guard can reject it. */
  function writeTheme(fileName: string, padBytes: number): void {
    const themesDir = getUserThemesDir();
    fs.mkdirSync(themesDir, { recursive: true });
    const theme = {
      ...structuredClone(builtinThemes[0]!),
      id: "padded",
      pad: "x".repeat(padBytes),
    };
    fs.writeFileSync(path.join(themesDir, fileName), JSON.stringify(theme));
  }

  it("loads a schema-valid padded theme that stays under the cap", () => {
    // Control case: proves the oversized case below is rejected by the size cap and not
    // by the theme schema (themeSchema is non-strict, so the `pad` key is simply stripped).
    writeTheme("padded.json", 1024);
    expect(listThemes().some((e) => e.theme.id === "padded")).toBe(true);
  });

  it("skips a theme file larger than the cap instead of reading it into memory", () => {
    writeTheme("padded.json", MAX_JSON_FILE_BYTES + 1024);
    expect(fs.statSync(path.join(getUserThemesDir(), "padded.json")).size).toBeGreaterThan(
      MAX_JSON_FILE_BYTES,
    );
    expect(() => listThemes()).not.toThrow();
    expect(listThemes().some((e) => e.theme.id === "padded")).toBe(false);
  });

  it("rejects an oversized config.json rather than allocating it", () => {
    const configPath = getConfigFilePath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        schemaVersion: "1.0",
        activeThemeId: null,
        activeProfileId: null,
        initializedAt: new Date().toISOString(),
        pad: "x".repeat(MAX_JSON_FILE_BYTES + 1024),
      }),
    );
    expect(() => readConfig()).toThrow(FileTooLargeError);
  });

  it("still reads a normal config.json", () => {
    const configPath = getConfigFilePath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        schemaVersion: "1.0",
        activeThemeId: "ghost-protocol",
        activeProfileId: null,
        initializedAt: new Date().toISOString(),
      }),
    );
    expect(readConfig().activeThemeId).toBe("ghost-protocol");
  });
});
