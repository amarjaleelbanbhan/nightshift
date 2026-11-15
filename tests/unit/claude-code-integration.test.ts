import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  readClaudeCodeSettings,
  claudeThemeAppearance,
  backgroundAppearance,
} from "../../src/core/integrations/claude-code.js";
import { MAX_JSON_FILE_BYTES } from "../../src/security/limits.js";
import { getTheme } from "../../src/core/themes/registry.js";

/**
 * The whole of the Claude Code integration (#18): read one key, never write the file, and
 * report when Claude Code's light/dark setting disagrees with the terminal background.
 *
 * The scope is the point of these tests as much as the behaviour. `~/.claude/settings.json` can
 * contain `env`, `permissions` and `hooks`, any of which may hold a token, so "only `theme`
 * comes back" is a security property and is asserted as one - not an implementation detail.
 */

describe("readClaudeCodeSettings", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function write(content: string): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-claude-"));
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, content);
    return file;
  }

  it("reports absent for a null path", () => {
    expect(readClaudeCodeSettings(null)).toEqual({ state: "absent" });
  });

  it("reports absent for a path that does not exist", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-claude-"));
    expect(readClaudeCodeSettings(path.join(dir, "nope.json"))).toEqual({ state: "absent" });
  });

  it("reads the theme key", () => {
    const file = write(JSON.stringify({ theme: "dark" }));
    expect(readClaudeCodeSettings(file)).toEqual({ state: "read", theme: "dark" });
  });

  it("reports theme null when the file sets no theme", () => {
    const file = write(JSON.stringify({ model: "opus" }));
    expect(readClaudeCodeSettings(file)).toEqual({ state: "read", theme: null });
  });

  it("returns ONLY the theme, never any other key", () => {
    // The security property, asserted directly. This file is realistic: Claude Code really does
    // store `env` and `permissions` here, and an `env` block really can hold an API key. A
    // `doctor` report gets pasted into bug threads, so anything this function returns is
    // something that could end up in one.
    const file = write(
      JSON.stringify({
        theme: "dark",
        env: { ANTHROPIC_API_KEY: "sk-ant-secret-value" },
        permissions: { allow: ["Bash(npm:*)"] },
        hooks: { Stop: [{ command: "notify-send done" }] },
        model: "opus",
      }),
    );

    const result = readClaudeCodeSettings(file);

    expect(result).toEqual({ state: "read", theme: "dark" });
    // Belt and braces: no amount of future refactoring should let a secret through.
    expect(JSON.stringify(result)).not.toContain("sk-ant");
    expect(JSON.stringify(result)).not.toContain("ANTHROPIC_API_KEY");
  });

  it("does not reject a settings file for containing Claude Code's own keys", () => {
    // A `strictObject` here would be actively wrong - it would refuse every real settings file.
    const file = write(JSON.stringify({ model: "opus", statusLine: { type: "command" } }));
    expect(readClaudeCodeSettings(file).state).toBe("read");
  });

  it.each([
    ["malformed JSON", "{ not json"],
    ["a JSON array at the root", "[]"],
    ["a bare string", '"dark"'],
    ["a non-string theme", JSON.stringify({ theme: 42 })],
    ["a null theme", JSON.stringify({ theme: null })],
  ])("reports %s as unreadable rather than throwing", (_label, content) => {
    const file = write(content);
    const result = readClaudeCodeSettings(file);
    expect(result.state).toBe("unreadable");
    // The detail has to be printable: `doctor` renders it into a table cell.
    expect(typeof (result as { detail: string }).detail).toBe("string");
    expect((result as { detail: string }).detail.length).toBeGreaterThan(0);
  });

  it("reports an oversized settings file as unreadable instead of reading it", () => {
    // Another tool's file, so its size is not ours to assume. The shared guard stats before
    // reading, so an oversized file is never allocated.
    const file = write(`{"theme":"dark","pad":"${"x".repeat(MAX_JSON_FILE_BYTES)}"}`);
    const result = readClaudeCodeSettings(file);
    expect(result.state).toBe("unreadable");
    expect((result as { detail: string }).detail).toMatch(/exceeds/i);
  });

  it("never writes to the file it reads", () => {
    const file = write(JSON.stringify({ theme: "light" }));
    const before = fs.readFileSync(file);
    const mtime = fs.statSync(file).mtimeMs;

    readClaudeCodeSettings(file);

    expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
  });
});

describe("claudeThemeAppearance", () => {
  it.each([
    ["dark", "dark"],
    ["light", "light"],
    // Prefix matching, not an enumerated list: a variant this project has never heard of still
    // answers the only question being asked, and hard-coding the list would turn Claude Code
    // shipping a new variant into a false mismatch report.
    ["dark-daltonized", "dark"],
    ["light-daltonized", "light"],
    ["dark-ansi", "dark"],
    ["light-ansi", "light"],
  ])("maps %s to %s", (theme, expected) => {
    expect(claudeThemeAppearance(theme)).toBe(expected);
  });

  it.each([[null], [""], ["solarized"], ["Dark"]])(
    "returns null for %j, which is neither light nor dark",
    (theme) => {
      // `"Dark"` is deliberately null rather than coerced: Claude Code's ids are lowercase, and
      // guessing at a near-miss is how a tool starts reporting confident nonsense.
      expect(claudeThemeAppearance(theme)).toBeNull();
    },
  );
});

describe("backgroundAppearance", () => {
  it.each([
    ["#000000", "dark"],
    ["#FFFFFF", "light"],
    ["#0A0D0B", "dark"],
    ["#F5F5F5", "light"],
  ])("classifies %s as %s", (hex, expected) => {
    expect(backgroundAppearance(hex)).toBe(expected);
  });

  it("splits at the WCAG luminance midpoint", () => {
    // 0.179 is where black and white text have equal contrast against the background. The
    // crossover was measured rather than guessed: #757575 is 0.1779 and #767676 is 0.1812, so
    // these two adjacent greys are the tightest possible pin on the threshold. A change to the
    // constant or to the luminance maths moves one of them.
    expect(backgroundAppearance("#757575")).toBe("dark");
    expect(backgroundAppearance("#767676")).toBe("light");
  });

  it("weights channels per WCAG rather than averaging them", () => {
    // All three of these have exactly one channel maxed, so any RGB average would classify
    // them identically. WCAG's coefficients do not: green 0.7152, red 0.2126, blue 0.0722 - so
    // pure blue is a dark background and pure red is a light one. That is the whole reason this
    // reuses contrast.ts's luminance instead of inventing a second notion of brightness.
    expect(backgroundAppearance("#00FF00")).toBe("light");
    expect(backgroundAppearance("#FF0000")).toBe("light");
    expect(backgroundAppearance("#0000FF")).toBe("dark");
  });

  it("classifies every built-in theme's background as dark", () => {
    // All four built-ins are dark themes, so Claude Code's `light` is a mismatch against any of
    // them. If a light built-in is ever added this test is the reminder to re-read the check.
    for (const id of ["ghost-protocol", "monolith", "redline", "deep-space"]) {
      const theme = getTheme(id);
      expect(theme, id).toBeDefined();
      expect(backgroundAppearance(theme!.colors.background), id).toBe("dark");
    }
  });
});
