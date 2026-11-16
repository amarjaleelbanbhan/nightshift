import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  validateThemeFile,
  createTheme,
  editTheme,
  removeTheme,
  DEFAULT_BASE_THEME_ID,
} from "../../src/core/themes/manager.js";
import { listThemes, getTheme, userThemeFileExists } from "../../src/core/themes/registry.js";
import { contrastRatio } from "../../src/core/themes/contrast.js";
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

    it("allows --overwrite on the ACTIVE theme and leaves it active with its new definition", () => {
      createTheme({ id: "live", name: "Live", from: "ghost-protocol" });
      initializeConfig();
      writeConfig({ ...readConfig(), activeThemeId: "live" });

      const result = createTheme({ id: "live", name: "Live v2", from: "redline", overwrite: true });

      // Deliberately asymmetric with removeTheme, which refuses the active theme: editing the
      // active theme is the ordinary authoring loop, whereas deleting it would leave the config
      // naming a file that no longer exists. The asymmetry is pinned because it is surprising.
      expect(result.ok).toBe(true);
      expect(readConfig().activeThemeId).toBe("live");
      // The colours behind that id have changed on disk with no `theme apply`, so Windows
      // Terminal keeps showing the old ones until the user re-applies. Nothing warns about that
      // gap today; this records where it is.
      expect(getTheme("live")?.name).toBe("Live v2");
      expect(getTheme("live")?.colors.background).toBe(getTheme("redline")?.colors.background);
    });
  });

  describe("editTheme", () => {
    /** Creates a user theme and returns its file path. */
    const seed = (id: string, from = "ghost-protocol"): string => {
      const result = createTheme({ id, name: `Theme ${id}`, from });
      return result.path as string;
    };

    it("changes exactly the one colour, and leaves every other key and the formatting alone", () => {
      const file = seed("editable");
      const before = fs.readFileSync(file, "utf8");

      const result = editTheme({ id: "editable", set: ["primary=#ABCDEF"] });

      expect(result.ok).toBe(true);
      expect(result.message).toBe('Updated theme "editable" (1 colour).');
      expect(result.changes).toEqual([
        {
          role: "primary",
          path: "colors.primary",
          from: getTheme("ghost-protocol")?.colors.primary,
          to: "#ABCDEF",
        },
      ]);

      // The assertion that matters is the *diff*, not the field: a writer that happened to set
      // primary correctly while reordering keys, dropping `typography` or re-indenting would
      // still have rewritten the user's file, and a field check would pass.
      const after = fs.readFileSync(file, "utf8");
      const changedLines = after
        .split("\n")
        .filter((line, index) => line !== before.split("\n")[index]);
      expect(changedLines).toEqual(['    "primary": "#ABCDEF",']);
    });

    it("applies several --set flags in one run, including ANSI colours", () => {
      seed("multi");
      const result = editTheme({
        id: "multi",
        set: ["background=#101010", "brightRed=#FF0000"],
      });

      expect(result.ok).toBe(true);
      expect(result.message).toBe('Updated theme "multi" (2 colours).');
      expect(result.changes.map((c) => c.path)).toEqual(["colors.background", "ansi.brightRed"]);
      expect(getTheme("multi")?.colors.background).toBe("#101010");
      expect(getTheme("multi")?.ansi.brightRed).toBe("#FF0000");
    });

    it("reports the contrast of the NEW colour, not the old one", () => {
      seed("contrasty");
      const background = getTheme("contrasty")?.colors.background as string;
      const oldForeground = getTheme("contrasty")?.colors.foreground as string;

      const result = editTheme({ id: "contrasty", set: ["foreground=#FFFFFF"] });

      const foreground = result.contrast.find((r) => r.role === "foreground");
      expect(foreground?.hex).toBe("#FFFFFF");
      // Measured against the engine rather than against a hand-copied number, and pinned as
      // *different* from the old value's ratio, which is the mistake being guarded: a report
      // built before the change would have been internally consistent and wrong.
      expect(foreground?.ratio).toBe(Math.round(contrastRatio("#FFFFFF", background) * 100) / 100);
      expect(foreground?.ratio).not.toBe(
        Math.round(contrastRatio(oldForeground, background) * 100) / 100,
      );
    });

    it("writes a dim theme and reports the failing ratio instead of refusing it", () => {
      seed("dim");
      const result = editTheme({ id: "dim", set: ["primary=#111111"] });

      // The same rule `theme validate` follows: contrast is advisory everywhere. A theme the
      // user deliberately made dim is still their theme.
      expect(result.ok).toBe(true);
      expect(result.contrast.find((r) => r.role === "primary")?.passesBody).toBe(false);
      expect(getTheme("dim")?.colors.primary).toBe("#111111");
    });

    it("refuses an invalid hex with the field path `theme validate` reports, and writes nothing", () => {
      const file = seed("badhex");
      const before = fs.readFileSync(file, "utf8");

      const result = editTheme({ id: "badhex", set: ["primary=blue"] });

      expect(result.ok).toBe(false);
      expect(result.issues).toEqual([
        { path: "colors.primary", message: "must be a 6-digit hex color, e.g. #1A2B3C" },
      ]);
      expect(fs.readFileSync(file, "utf8")).toBe(before);
    });

    it("refuses a three-digit hex, which the contrast engine accepts but the schema does not", () => {
      // `parseHex` in contrast.ts handles `#abc`, so this is the one invalid value that would
      // produce a plausible-looking contrast report if the schema check were skipped.
      seed("shorthex");
      const result = editTheme({ id: "shorthex", set: ["primary=#abc"] });
      expect(result.ok).toBe(false);
      expect(result.issues.map((i) => i.path)).toEqual(["colors.primary"]);
      expect(getTheme("shorthex")?.colors.primary).not.toBe("#abc");
    });

    it("refuses an unknown role, naming the roles that do exist", () => {
      const file = seed("roles");
      const before = fs.readFileSync(file, "utf8");

      const result = editTheme({ id: "roles", set: ["selectionBackground=#123456"] });

      expect(result.ok).toBe(false);
      expect(result.message).toContain('"selectionBackground" is not a colour role');
      // The remedy is in the message because the valid names are the whole answer.
      expect(result.message).toContain("selection");
      expect(result.message).toContain("brightWhite");
      expect(fs.readFileSync(file, "utf8")).toBe(before);
    });

    it("refuses a --set without an `=`, and a run with no --set at all", () => {
      seed("malformed");
      expect(editTheme({ id: "malformed", set: ["primary"] }).message).toContain(
        "is not a role=value pair",
      );
      expect(editTheme({ id: "malformed", set: [] }).message).toContain("No colour given");
    });

    it("never edits a built-in theme, and suggests nothing a flag could lift", () => {
      const result = editTheme({ id: "monolith", set: ["primary=#ABCDEF"] });

      expect(result.ok).toBe(false);
      expect(result.message).toBe('"monolith" is a built-in theme and cannot be edited in place.');
      // Not shadowed by a user file either - the refusal happens before any path is built, so
      // there is nothing to clean up and nothing for `theme list` to show twice.
      expect(fs.existsSync(path.join(getUserThemesDir(), "monolith.json"))).toBe(false);
      expect(getTheme("monolith")?.colors.primary).not.toBe("#ABCDEF");
    });

    it("refuses a malformed id before it can become a path, and an unknown id", () => {
      expect(editTheme({ id: "../../evil", set: ["primary=#ABCDEF"] }).message).toContain(
        "is not a valid theme id",
      );
      expect(editTheme({ id: "never-existed", set: ["primary=#ABCDEF"] }).message).toContain(
        'No user theme found with id "never-existed"',
      );
    });

    it("refuses a file that exists but does not validate, rather than editing one key of it", () => {
      // The hand-edited-into-invalidity file is exactly the case this command exists to spare
      // people, so it must not be made worse by a partial write on top.
      fs.mkdirSync(getUserThemesDir(), { recursive: true });
      const file = path.join(getUserThemesDir(), "broken.json");
      fs.writeFileSync(file, JSON.stringify({ ...VALID, id: "broken", ansi: {} }));

      const result = editTheme({ id: "broken", set: ["primary=#ABCDEF"] });
      expect(result.ok).toBe(false);
      expect(result.message).toContain("exists but is not a valid theme");
      expect(JSON.parse(fs.readFileSync(file, "utf8")).colors.primary).toBe(VALID.colors.primary);
    });

    describe("--dry-run", () => {
      it("reports the change and the new contrast, and writes nothing", () => {
        const file = seed("previewed");
        const before = fs.readFileSync(file, "utf8");

        const result = editTheme({
          id: "previewed",
          set: ["primary=#ABCDEF"],
          dryRun: true,
        });

        expect(result.ok).toBe(true);
        expect(result.message).toBe('Editing "previewed" would change 1 colour.');
        expect(result.changes[0]?.to).toBe("#ABCDEF");
        expect(result.contrast.find((r) => r.role === "primary")?.hex).toBe("#ABCDEF");
        // Byte equality rather than a field check, for the same reason as the write test: a dry
        // run that reformatted the file would have written.
        expect(fs.readFileSync(file, "utf8")).toBe(before);
      });

      it("refuses what the real run refuses, so it is a genuine pre-flight check", () => {
        seed("preflight");
        expect(editTheme({ id: "preflight", set: ["primary=nope"], dryRun: true }).ok).toBe(false);
        expect(editTheme({ id: "monolith", set: ["primary=#ABCDEF"], dryRun: true }).ok).toBe(
          false,
        );
      });
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

    it("leaves the config byte-for-byte alone when the removed theme is not the active one", () => {
      createTheme({ id: "keeper", name: "Keeper" });
      createTheme({ id: "goner", name: "Goner" });
      initializeConfig();
      writeConfig({ ...readConfig(), activeThemeId: "keeper" });
      const configPath = path.join(tmpRoot, "nightshift", "config.json");
      const before = fs.readFileSync(configPath, "utf8");

      expect(removeTheme("goner").ok).toBe(true);

      // removeTheme reads the config to make its decision and must never write one back.
      // Byte equality is the assertion rather than a field check, because a rewrite that
      // happened to preserve activeThemeId would still have reformatted the file and clobbered
      // any field a future schema version added.
      expect(fs.readFileSync(configPath, "utf8")).toBe(before);
      expect(userThemeFileExists("keeper")).toBe(true);
      expect(userThemeFileExists("goner")).toBe(false);
    });

    it("removes a theme without materialising a config when none exists yet", () => {
      // `readConfig()` returns defaults for a missing file, so the active-theme check works
      // before `init` has ever run. It must not create the file as a side effect - a user who
      // has not initialised has no active theme and should still be able to delete their own.
      createTheme({ id: "pre-init", name: "Pre Init" });
      expect(fs.existsSync(path.join(tmpRoot, "nightshift", "config.json"))).toBe(false);

      expect(removeTheme("pre-init").ok).toBe(true);
      expect(fs.existsSync(path.join(tmpRoot, "nightshift", "config.json"))).toBe(false);
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
