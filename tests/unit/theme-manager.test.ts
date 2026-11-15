import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  validateThemeFile,
  createTheme,
  removeTheme,
  DEFAULT_BASE_THEME_ID,
} from "../../src/core/themes/manager.js";
import { listThemes, getTheme, userThemeFileExists } from "../../src/core/themes/registry.js";
import { initializeConfig, writeConfig, readConfig } from "../../src/core/config/store.js";
import { getUserThemesDir } from "../../src/core/config/paths.js";

/**
 * The mutating theme operations (`theme validate|create|remove`), exercised against a temporary
 * APPDATA so the developer's real user-themes directory is never touched.
 *
 * The rules under test are the ones that protect the user's files: a built-in id is never
 * writable under any flag, an existing user theme needs --overwrite, a malformed id never
 * becomes a path, and the active theme cannot be deleted out from under the config.
 */

const VALID = {
  id: "fixture-theme",
  schemaVersion: "1.0",
  name: "Fixture Theme",
  colors: {
    background: "#000000",
    foreground: "#FFFFFF",
    primary: "#FFFFFF",
    secondary: "#CCCCCC",
    success: "#00FF00",
    warning: "#FFFF00",
    error: "#FF5555",
    selection: "#333333",
    cursor: "#FFFFFF",
  },
  ansi: {
    black: "#000000",
    red: "#FF5555",
    green: "#00FF00",
    yellow: "#FFFF00",
    blue: "#5555FF",
    purple: "#AA55AA",
    cyan: "#55FFFF",
    white: "#FFFFFF",
    brightBlack: "#555555",
    brightRed: "#FF8888",
    brightGreen: "#88FF88",
    brightYellow: "#FFFF88",
    brightBlue: "#8888FF",
    brightPurple: "#CC88CC",
    brightCyan: "#88FFFF",
    brightWhite: "#FFFFFF",
  },
};

describe("theme manager", () => {
  let tmpRoot: string;
  let originalAppData: string | undefined;
  let originalXdg: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-theme-manager-"));
    originalAppData = process.env.APPDATA;
    originalXdg = process.env.XDG_CONFIG_HOME;
    process.env.APPDATA = tmpRoot;
    process.env.XDG_CONFIG_HOME = tmpRoot;
  });

  afterEach(() => {
    process.env.APPDATA = originalAppData;
    process.env.XDG_CONFIG_HOME = originalXdg;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const fixture = (name: string, contents: string): string => {
    const p = path.join(tmpRoot, name);
    fs.writeFileSync(p, contents);
    return p;
  };

  describe("validateThemeFile", () => {
    it("accepts a valid theme and reports no issues", () => {
      const result = validateThemeFile(fixture("ok.json", JSON.stringify(VALID)));
      expect(result.ok).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.theme?.id).toBe("fixture-theme");
      expect(result.message).toContain('"Fixture Theme" (fixture-theme) is a valid theme');
    });

    it("reports EVERY schema issue with its field path, not just the first", () => {
      const broken = {
        ...VALID,
        id: "Bad_ID",
        schemaVersion: "2.0",
        colors: { ...VALID.colors, background: "#000", primary: "nope" },
      };
      const result = validateThemeFile(fixture("bad.json", JSON.stringify(broken)));

      expect(result.ok).toBe(false);
      const paths = result.issues.map((i) => i.path);
      // All four distinct problems in one run - the whole point of the command.
      expect(paths).toContain("id");
      expect(paths).toContain("schemaVersion");
      expect(paths).toContain("colors.background");
      expect(paths).toContain("colors.primary");
      expect(result.issues.length).toBeGreaterThanOrEqual(4);
    });

    it("treats low contrast as a warning, never as a validation failure", () => {
      const dim = {
        ...VALID,
        colors: { ...VALID.colors, primary: "#111111", secondary: "#0A0A0A" },
      };
      const result = validateThemeFile(fixture("dim.json", JSON.stringify(dim)));

      // A dim theme is a legal theme. Failing it would make `validate` unusable for exactly
      // the themes people write on purpose.
      expect(result.ok).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.warnings.map((w) => w.role).sort()).toEqual(["primary", "secondary"]);
      expect(result.warnings.every((w) => w.passesBody === false)).toBe(true);
    });

    it("reports a missing file, a directory, and unparseable JSON without throwing", () => {
      expect(validateThemeFile("../../../definitely/not/here.json").message).toContain(
        "No file found",
      );
      expect(validateThemeFile(tmpRoot).message).toContain("not a regular file");
      expect(validateThemeFile(fixture("junk.json", "{ nope")).message).toContain("not valid JSON");
      // None of these reached the schema, so there is no field list to show.
      expect(validateThemeFile(fixture("junk2.json", "{ nope")).issues).toEqual([]);
    });
  });

  describe("createTheme", () => {
    it("clones a built-in, writes it, and the registry then lists it as a user theme", () => {
      const result = createTheme({ id: "my-theme", name: "My Theme", from: "deep-space" });

      expect(result.ok).toBe(true);
      expect(result.path).toBe(path.join(getUserThemesDir(), "my-theme.json"));
      expect(fs.existsSync(result.path as string)).toBe(true);

      const entry = listThemes().find((e) => e.theme.id === "my-theme");
      expect(entry?.source).toBe("user");
      // Identity replaced, palette inherited from the clone source.
      expect(entry?.theme.name).toBe("My Theme");
      expect(entry?.theme.colors).toEqual(getTheme("deep-space")?.colors);
      // The base's description described the base, so it is not inherited.
      expect(entry?.theme.description).toBeUndefined();
    });

    it("defaults --from to the documented base theme", () => {
      const result = createTheme({ id: "defaulted", name: "Defaulted" });
      expect(result.ok).toBe(true);
      expect(result.message).toContain(`from "${DEFAULT_BASE_THEME_ID}"`);
      expect(getTheme("defaulted")?.colors).toEqual(getTheme(DEFAULT_BASE_THEME_ID)?.colors);
    });

    it("keeps a description when one is given", () => {
      createTheme({ id: "described", name: "Described", description: "Mine." });
      expect(getTheme("described")?.description).toBe("Mine.");
    });

    it("refuses an existing user theme without --overwrite, and replaces it with one", () => {
      createTheme({ id: "dup", name: "First" });

      const refused = createTheme({ id: "dup", name: "Second" });
      expect(refused.ok).toBe(false);
      expect(refused.message).toContain("already exists");
      expect(refused.message).toContain("--overwrite");
      expect(getTheme("dup")?.name).toBe("First");

      const forced = createTheme({ id: "dup", name: "Second", overwrite: true });
      expect(forced.ok).toBe(true);
      expect(getTheme("dup")?.name).toBe("Second");
    });

    it("never overwrites a built-in theme id, even with --overwrite", () => {
      for (const overwrite of [false, true]) {
        const result = createTheme({ id: "ghost-protocol", name: "Hijacked", overwrite });
        expect(result.ok).toBe(false);
        expect(result.message).toContain("built-in theme id and cannot be overwritten");
      }
      // No shadowing file was left behind, and the built-in is untouched.
      expect(fs.existsSync(path.join(getUserThemesDir(), "ghost-protocol.json"))).toBe(false);
      expect(getTheme("ghost-protocol")?.name).toBe("Ghost Protocol");
    });

    it("rejects a traversal id as an invalid id and writes nothing", () => {
      const result = createTheme({ id: "../../evil", name: "Evil" });
      expect(result.ok).toBe(false);
      expect(result.message).toContain("id must be lowercase alphanumeric with hyphens only");
      expect(fs.existsSync(path.join(tmpRoot, "..", "..", "evil.json"))).toBe(false);
    });

    it("reports an unknown --from instead of writing a half-formed theme", () => {
      const result = createTheme({ id: "orphan", name: "Orphan", from: "does-not-exist" });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('No theme found with id "does-not-exist"');
      expect(userThemeFileExists("orphan")).toBe(false);
    });

    it("writes a file that its own validator accepts", () => {
      const result = createTheme({ id: "round-trip", name: "Round Trip" });
      expect(validateThemeFile(result.path as string).ok).toBe(true);
    });
  });

  describe("removeTheme", () => {
    it("removes a user theme", () => {
      createTheme({ id: "goner", name: "Goner" });
      expect(removeTheme("goner")).toEqual({ ok: true, message: 'Removed theme "goner".' });
      expect(userThemeFileExists("goner")).toBe(false);
    });

    it("refuses a built-in theme", () => {
      const result = removeTheme("monolith");
      expect(result.ok).toBe(false);
      expect(result.message).toContain("built-in theme and cannot be removed");
    });

    it("refuses an unknown id", () => {
      expect(removeTheme("never-existed").message).toContain(
        'No user theme found with id "never-existed"',
      );
    });

    it("refuses a malformed id before it can become a path", () => {
      const result = removeTheme("../../evil");
      expect(result.ok).toBe(false);
      expect(result.message).toContain("is not a valid theme id");
    });

    it("refuses the active theme and leaves the file in place", () => {
      createTheme({ id: "in-use", name: "In Use" });
      initializeConfig();
      writeConfig({ ...readConfig(), activeThemeId: "in-use" });

      const result = removeTheme("in-use");
      expect(result.ok).toBe(false);
      expect(result.message).toContain("is the active theme and cannot be removed");
      expect(userThemeFileExists("in-use")).toBe(true);
    });

    it("reads the config before unlinking, so a corrupt config cannot leave a deleted file", () => {
      createTheme({ id: "survivor", name: "Survivor" });
      fs.writeFileSync(path.join(tmpRoot, "nightshift", "config.json"), "{ not json");

      // Same ordering bug as A-10 in profiles/manager.ts: the read has to happen first, or a
      // throw here leaves the theme gone and the config still naming it.
      expect(() => removeTheme("survivor")).toThrow();
      expect(userThemeFileExists("survivor")).toBe(true);
    });
  });
});
