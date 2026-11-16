import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `theme validate|create|remove` against the real built binary, each run with an isolated
 * APPDATA so the developer's own user-themes directory is never written.
 *
 * These assert the *exit codes* in particular: the core logic is covered by
 * `tests/unit/theme-manager.test.ts`, and what only a real process can prove is that a refusal
 * reaches the exit-code contract (1 for every usage and runtime failure) rather than being
 * printed and then exiting 0.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.resolve(__dirname, "../../dist/index.js");

describe("theme authoring commands (built dist/index.js)", () => {
  let appData: string;

  const run = (args: string[]): { stdout: string; stderr: string; status: number } => {
    try {
      const stdout = execFileSync(process.execPath, [cliEntry, ...args], {
        encoding: "utf8",
        env: { ...process.env, APPDATA: appData, XDG_CONFIG_HOME: appData },
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { stdout, stderr: "", status: 0 };
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; status?: number };
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
    }
  };

  beforeEach(() => {
    appData = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-authoring-"));
  });

  afterEach(() => {
    fs.rmSync(appData, { recursive: true, force: true });
  });

  it("creates a theme that then appears in `theme list` and validates clean", () => {
    const created = run([
      "theme",
      "create",
      "--id",
      "my-theme",
      "--name",
      "My Theme",
      "--from",
      "deep-space",
    ]);
    expect(created.status).toBe(0);
    expect(created.stdout).toContain('Created theme "my-theme" from "deep-space"');

    const listed = run(["theme", "list"]);
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain("my-theme");
    expect(listed.stdout).toContain("user");

    const themeFile = path.join(appData, "nightshift", "themes", "my-theme.json");
    const validated = run(["theme", "validate", themeFile]);
    expect(validated.status).toBe(0);
    expect(validated.stdout).toContain("is a valid theme");
  });

  it("exits 1 and lists every field path for an invalid theme file", () => {
    const bad = path.join(appData, "bad.json");
    fs.writeFileSync(
      bad,
      JSON.stringify({
        id: "Bad_ID",
        schemaVersion: "2.0",
        name: "",
        colors: { background: "#000" },
      }),
    );

    const { stdout, stderr, status } = run(["theme", "validate", bad]);
    const text = stdout + stderr;

    expect(status).toBe(1);
    expect(text).toContain("is not a valid theme");
    // Several distinct paths in one run, not just the first failure.
    expect(text).toContain("id:");
    expect(text).toContain("schemaVersion:");
    expect(text).toContain("colors.background:");
    expect(text).toContain("ansi:");
    // Every failure carries a next step.
    expect(text).toContain("→");
  });

  it("exits 1 creating a duplicate id without --overwrite", () => {
    run(["theme", "create", "--id", "dup", "--name", "First"]);

    const duplicate = run(["theme", "create", "--id", "dup", "--name", "Second"]);
    expect(duplicate.status).toBe(1);
    expect(duplicate.stderr).toContain("already exists");
    expect(duplicate.stderr).toContain("--overwrite");
  });

  it("exits 1 creating a built-in id even with --overwrite, and for a traversal id", () => {
    const builtin = run(["theme", "create", "--id", "monolith", "--name", "Hijack", "--overwrite"]);
    expect(builtin.status).toBe(1);
    expect(builtin.stderr).toContain("built-in theme id and cannot be overwritten");

    const traversal = run(["theme", "create", "--id", "../../evil", "--name", "Evil"]);
    expect(traversal.status).toBe(1);
    expect(traversal.stderr).toContain("id must be lowercase alphanumeric with hyphens only");
    expect(fs.existsSync(path.join(appData, "..", "evil.json"))).toBe(false);
  });

  it("edits a colour, reports the new contrast ratio, and keeps the file valid", () => {
    run(["theme", "create", "--id", "mine", "--name", "Mine", "--from", "deep-space"]);
    const themeFile = path.join(appData, "nightshift", "themes", "mine.json");

    const edited = run(["theme", "edit", "mine", "--set", "primary=#FFFFFF"]);
    expect(edited.status).toBe(0);
    expect(edited.stdout).toContain('Updated theme "mine" (1 colour).');
    expect(edited.stdout).toContain("colors.primary");
    // The ratio shown is the one for #FFFFFF, which on deep-space's background is the maximum
    // the theme can reach - the pre-edit primary cannot produce this line.
    expect(edited.stdout).toContain("#FFFFFF");
    expect(edited.stdout).toContain("Contrast against background");
    expect(JSON.parse(fs.readFileSync(themeFile, "utf8")).colors.primary).toBe("#FFFFFF");
    expect(run(["theme", "validate", themeFile]).status).toBe(0);
  });

  it("--dry-run prints the change and writes nothing", () => {
    run(["theme", "create", "--id", "mine", "--name", "Mine"]);
    const themeFile = path.join(appData, "nightshift", "themes", "mine.json");
    const before = fs.readFileSync(themeFile, "utf8");

    const { stdout, status } = run([
      "theme",
      "edit",
      "mine",
      "--set",
      "primary=#FFFFFF",
      "--dry-run",
    ]);

    expect(status).toBe(0);
    expect(stdout).toContain("Dry run");
    expect(stdout).toContain("Nothing was written");
    expect(fs.readFileSync(themeFile, "utf8")).toBe(before);
  });

  it("exits 1 for an invalid hex, naming the same field path `theme validate` names", () => {
    run(["theme", "create", "--id", "mine", "--name", "Mine"]);
    const themeFile = path.join(appData, "nightshift", "themes", "mine.json");
    const before = fs.readFileSync(themeFile, "utf8");

    const { stdout, stderr, status } = run(["theme", "edit", "mine", "--set", "primary=blue"]);
    const text = stdout + stderr;

    expect(status).toBe(1);
    expect(text).toContain("colors.primary: must be a 6-digit hex color");
    expect(fs.readFileSync(themeFile, "utf8")).toBe(before);
  });

  it("exits 1 editing a built-in and suggests cloning it instead", () => {
    const { stderr, status } = run(["theme", "edit", "monolith", "--set", "primary=#FFFFFF"]);

    expect(status).toBe(1);
    expect(stderr).toContain("built-in theme and cannot be edited in place");
    // The refusal is only useful with the thing to do instead, and `--from` is what does it.
    expect(stderr).toContain("--from monolith");
    expect(fs.existsSync(path.join(appData, "nightshift", "themes", "monolith.json"))).toBe(false);
  });

  it("exits 1 for an unknown role and for a --set with no value", () => {
    run(["theme", "create", "--id", "mine", "--name", "Mine"]);

    const unknown = run(["theme", "edit", "mine", "--set", "selectionBackground=#FFFFFF"]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("is not a colour role");

    const malformed = run(["theme", "edit", "mine", "--set", "primary"]);
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain("is not a role=value pair");
  });

  it("applies several --set flags in one invocation", () => {
    run(["theme", "create", "--id", "mine", "--name", "Mine"]);

    const { stdout, status } = run([
      "theme",
      "edit",
      "mine",
      "--set",
      "background=#101010",
      "--set",
      "brightRed=#FF0000",
    ]);

    expect(status).toBe(0);
    expect(stdout).toContain("(2 colours)");
    const theme = JSON.parse(
      fs.readFileSync(path.join(appData, "nightshift", "themes", "mine.json"), "utf8"),
    );
    expect(theme.colors.background).toBe("#101010");
    expect(theme.ansi.brightRed).toBe("#FF0000");
  });

  it("removes a user theme (exit 0) and refuses a built-in (exit 1)", () => {
    run(["theme", "create", "--id", "goner", "--name", "Goner"]);

    expect(run(["theme", "remove", "goner"]).status).toBe(0);
    expect(fs.existsSync(path.join(appData, "nightshift", "themes", "goner.json"))).toBe(false);

    const builtin = run(["theme", "remove", "redline"]);
    expect(builtin.status).toBe(1);
    expect(builtin.stderr).toContain("built-in theme and cannot be removed");
  });

  it("exits 1 removing an unknown id or a traversal id", () => {
    const unknown = run(["theme", "remove", "never-existed"]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("No user theme found");

    const traversal = run(["theme", "remove", "../../evil"]);
    expect(traversal.status).toBe(1);
    expect(traversal.stderr).toContain("is not a valid theme id");
  });

  it("refuses to remove the active theme and says how to switch away first", () => {
    run(["theme", "create", "--id", "in-use", "--name", "In Use"]);
    run(["init"]);
    const configPath = path.join(appData, "nightshift", "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    fs.writeFileSync(configPath, JSON.stringify({ ...config, activeThemeId: "in-use" }, null, 2));

    const { stderr, status } = run(["theme", "remove", "in-use"]);
    expect(status).toBe(1);
    expect(stderr).toContain("is the active theme and cannot be removed");
    expect(stderr).toContain("nightshift theme apply <other-id>");
    expect(fs.existsSync(path.join(appData, "nightshift", "themes", "in-use.json"))).toBe(true);
  });
});
