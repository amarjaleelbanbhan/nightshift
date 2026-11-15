import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.resolve(__dirname, "../../dist/index.js");

interface Run {
  stdout: string;
  stderr: string;
  status: number;
}

function runCli(args: string[], env: Record<string, string | undefined>): Run {
  try {
    const stdout = execFileSync(process.execPath, [cliEntry, ...args], {
      encoding: "utf8",
      env,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 20_000,
    });
    return { stdout, stderr: "", status: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
  }
}

/** A Node stack trace, a bare ZodError dump, or the Node version banner reaching the user. */
function expectNoStackTrace(run: Run): void {
  const combined = `${run.stdout}\n${run.stderr}`;
  expect(combined).not.toMatch(/^\s+at .+/m);
  expect(combined).not.toContain("ZodError");
  expect(combined).not.toContain("SyntaxError");
  expect(combined).not.toMatch(/Node\.js v\d+/);
}

const CORRUPT_CONFIGS: Array<[string, string]> = [
  ["invalid JSON", "{ not json"],
  ["an array at the root", "[]"],
  ["an object missing required fields", "{}"],
  [
    "valid JSON with the wrong schema",
    JSON.stringify({ schemaVersion: "2.0", activeThemeId: 5, initializedAt: true }),
  ],
];

describe("error handling and exit codes (built dist/index.js)", () => {
  let tmpRoot: string;
  let env: Record<string, string | undefined>;
  let configPath: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-errors-cli-"));
    const appData = path.join(tmpRoot, "AppData");
    fs.mkdirSync(path.join(appData, "nightshift"), { recursive: true });
    configPath = path.join(appData, "nightshift", "config.json");
    env = { ...process.env, APPDATA: appData, NO_COLOR: "1" };
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // `theme apply`/`profile apply` are excluded on purpose: they write the real Windows
  // Terminal settings.json regardless of APPDATA.
  for (const command of [["status"], ["theme", "list"], ["profile", "list"], ["doctor"]]) {
    for (const [label, body] of CORRUPT_CONFIGS) {
      it(`\`${command.join(" ")}\` with ${label} never shows a stack trace`, () => {
        fs.writeFileSync(configPath, body);
        const run = runCli(command, env);
        expectNoStackTrace(run);
      });
    }
  }

  for (const [label, body] of CORRUPT_CONFIGS) {
    it(`\`status\` reports ${label} with exit code 2 and still prints the report`, () => {
      fs.writeFileSync(configPath, body);
      const run = runCli(["status"], env);

      expect(run.status).toBe(2);
      // Degrades rather than dies: the capability report is still there.
      expect(run.stdout).toContain("Windows Terminal");
      expect(run.stdout).toContain("corrupt or unreadable");
      // ...and the corruption is named, with the remedy and the real path.
      expect(run.stderr).toContain(configPath);
      expect(run.stderr).toContain("nightshift init");
    });

    it(`\`profile list\` reports ${label} with exit code 2 and still lists profiles`, () => {
      fs.writeFileSync(configPath, body);
      const run = runCli(["profile", "list"], env);

      expect(run.status).toBe(2);
      expect(run.stdout).toContain("ghost-protocol-default");
      expect(run.stderr).toContain(configPath);
    });

    it(`\`theme list\` reports ${label} with exit code 2 and still lists themes`, () => {
      fs.writeFileSync(configPath, body);
      const run = runCli(["theme", "list"], env);

      expect(run.status).toBe(2);
      // Degrades like `status` and `profile list`: the table is printed, minus "(active)".
      expect(run.stdout).toContain("ghost-protocol");
      expect(run.stdout).toContain("monolith");
      expect(run.stdout).not.toContain("(active)");
      expect(run.stderr).toContain("configuration file could not be read");
      expect(run.stderr).toContain("nightshift init");
    });

    it(`\`doctor\` fails the config check and exits 2 for ${label}`, () => {
      fs.writeFileSync(configPath, body);
      const run = runCli(["doctor"], env);

      // A diagnostic that found a real fault must not report success...
      expect(run.status).toBe(2);
      // ...and must say so, with the glyph (not color alone) carrying the state.
      expect(run.stdout).toContain("NIGHTSHIFT config");
      expect(run.stdout).toContain("✗");
      expect(run.stdout).toContain("could not be read");
      // Every other check still runs - doctor stays useful while the config is broken.
      expect(run.stdout).toContain("Node.js version");
      expect(run.stdout).toContain("Windows Terminal");
    });
  }

  it("exits 0 with a valid config, so exit code 2 means something", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        schemaVersion: "1.0",
        activeThemeId: "ghost-protocol",
        activeProfileId: null,
        initializedAt: new Date().toISOString(),
      }),
    );

    expect(runCli(["status"], env).status).toBe(0);
    expect(runCli(["theme", "list"], env).status).toBe(0);
    expect(runCli(["profile", "list"], env).status).toBe(0);
    // doctor must stay 0 for a healthy config, or it is useless as a scripted health gate.
    expect(runCli(["doctor"], env).status).toBe(0);
  });

  it("exits 0 with no config file at all", () => {
    fs.rmSync(configPath, { force: true });
    expect(runCli(["status"], env).status).toBe(0);
    expect(runCli(["doctor"], env).status).toBe(0);
  });

  it("documents --no-color in --help", () => {
    const run = runCli(["--help"], env);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("--no-color");
  });

  it("gives a next step when a command fails (no dead ends)", () => {
    const cases: Array<[string[], string]> = [
      [["profile", "show", "nope"], "nightshift profile list"],
      [["profile", "remove", "nope"], "nightshift profile list"],
      [["profile", "export", "nope"], "nightshift profile list"],
      [["profile", "import", "no-such-file.json"], "nightshift profile export"],
      [["restore", "nope"], "nightshift backup list"],
    ];
    for (const [args, hint] of cases) {
      const run = runCli(args, env);
      expect(run.status, args.join(" ")).not.toBe(0);
      const out = run.stdout + run.stderr;
      expect(out, args.join(" ")).toContain("✗");
      expect(out, args.join(" ")).toContain("→");
      expect(out, args.join(" ")).toContain(hint);
    }
  });

  it("builds the Claude Code settings path with one separator style", () => {
    // F7: it used to be built by string concatenation, printing C:\Users\x/.claude/...
    const run = runCli(["doctor"], env);
    const mixed = /[A-Za-z]:\\[^\s│]*\/[^\s│]*\.claude/;
    expect(run.stdout).not.toMatch(mixed);
  });

  it("still prints help and exits 0 after the top-level handler was added", () => {
    const run = runCli(["--help"], env);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("Usage: nightshift");
    expect(run.stdout).toContain("doctor");
  });

  it("still prints the version and exits 0", () => {
    const run = runCli(["--version"], env);
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("reports a top-level typo as an unknown command, exit 1", () => {
    const run = runCli(["nosuchcommand"], env);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("unknown command 'nosuchcommand'");
    expect(run.stderr).not.toContain("too many arguments");
  });

  it("reports a missing required argument as a usage error, exit 1", () => {
    const run = runCli(["theme", "preview"], env);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("missing required argument");
  });

  it("turns an unknown backup id into a readable message, exit 1, no stack trace", () => {
    const run = runCli(["restore", "does-not-exist"], env);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('No backup found with id "does-not-exist"');
    expectNoStackTrace(run);
  });

  it("turns a traversal attempt in a backup id into a readable message, exit 1", () => {
    const run = runCli(["restore", "../../etc/passwd"], env);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("resolves outside the allowed directory");
    expectNoStackTrace(run);
  });
});
