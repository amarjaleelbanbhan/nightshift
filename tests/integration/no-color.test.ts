import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Asserts the *built binary* emits no ANSI escape sequences when color is turned off.
 *
 * Every case sets `FORCE_COLOR=3`. Without it this suite would be meaningless: chalk disables
 * color automatically for a piped (non-TTY) stream, so a passing assertion would prove only
 * that the output was piped - not that `NO_COLOR` was honoured. `FORCE_COLOR=3` forces the same
 * colored path a real TTY takes, and chalk/supports-color deliberately lets `FORCE_COLOR`
 * override `NO_COLOR`, so these tests also pin the project's decision to override that and let
 * the user's explicit opt-out win.
 */

const CLI = path.resolve("dist/index.js");
/** Matches a CSI escape sequence (ESC [ ... letter) - what chalk/boxen emit. */
const ANSI = /\[[0-9;]*[A-Za-z]/;

let configRoot: string;

function run(args: string[], extraEnv: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, APPDATA: configRoot, FORCE_COLOR: "3", ...extraEnv },
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

beforeEach(() => {
  configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-nocolor-"));
});

afterEach(() => {
  fs.rmSync(configRoot, { recursive: true, force: true });
});

const COMMANDS: string[][] = [
  ["status"],
  ["doctor"],
  ["theme", "list"],
  ["theme", "preview", "ghost-protocol"],
  ["profile", "list"],
  ["backup", "list"],
];

describe("color can actually be forced on", () => {
  // Guards the suite itself: if FORCE_COLOR stopped producing color, the NO_COLOR assertions
  // below would pass trivially and prove nothing.
  it.each(COMMANDS)("emits ANSI for `%s` under FORCE_COLOR=3", (...args: string[]) => {
    const { stdout, status } = run(args);
    expect(status).toBe(0);
    expect(ANSI.test(stdout)).toBe(true);
  });
});

describe("NO_COLOR=1", () => {
  it.each(COMMANDS)("produces ANSI-free output for `%s`", (...args: string[]) => {
    const { stdout, stderr, status } = run(args, { NO_COLOR: "1" });
    expect(status).toBe(0);
    expect(stdout).not.toMatch(ANSI);
    expect(stderr).not.toMatch(ANSI);
  });
});

describe("--no-color", () => {
  it.each(COMMANDS)("produces ANSI-free output for `%s`", (...args: string[]) => {
    const { stdout, stderr, status } = run([...args, "--no-color"]);
    // Also proves the flag is accepted rather than rejected as an unknown option.
    expect(status).toBe(0);
    expect(stdout).not.toMatch(ANSI);
    expect(stderr).not.toMatch(ANSI);
  });
});

describe("colorless output still carries the information", () => {
  it("shows each theme's hex values in `theme preview` when color is off", () => {
    const { stdout } = run(["theme", "preview", "ghost-protocol"], { NO_COLOR: "1" });
    // Background-only swatches are invisible without color, so the hex must be in the text.
    expect(stdout).toContain("#0A0D0B");
    expect(stdout).toContain("#65E58B");
  });

  it("still reports contrast ratios in `theme preview` when color is off", () => {
    const { stdout } = run(["theme", "preview", "ghost-protocol"], { NO_COLOR: "1" });
    expect(stdout).toContain("foreground");
    expect(stdout).toMatch(/\d+\.\d{2}:1/);
  });

  it("marks failures with a glyph, not color alone, in error output", () => {
    const { stdout, stderr, status } = run(["theme", "preview", "no-such-theme"], {
      NO_COLOR: "1",
    });
    expect(status).not.toBe(0);
    const out = stdout + stderr;
    expect(out).toContain("✗");
    expect(out).not.toMatch(ANSI);
  });
});
