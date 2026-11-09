import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { listThemes } from "../../src/core/themes/registry.js";
import { getUserThemesDir } from "../../src/core/config/paths.js";

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
