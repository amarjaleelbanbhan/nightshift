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
