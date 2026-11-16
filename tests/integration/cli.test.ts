import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.resolve(__dirname, "../../dist/index.js");

function runCli(
  args: string[],
  env: Record<string, string | undefined> = process.env,
): {
  stdout: string;
  status: number;
} {
  try {
    const stdout = execFileSync(process.execPath, [cliEntry, ...args], { encoding: "utf8", env });
    return { stdout, status: 0 };
  } catch (error) {
    const e = error as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

describe("CLI (built dist/index.js)", () => {
  it("prints the version with --version", () => {
    const { stdout, status } = runCli(["--version"]);
    expect(status).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("prints help with --help", () => {
    const { stdout, status } = runCli(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("nightshift");
    expect(stdout).toContain("theme");
    expect(stdout).toContain("doctor");
  });

  // Command *modules* are loaded lazily (dynamic `import()` inside each action handler) so a
  // one-shot invocation only pays for the command it runs. Command *registration* must stay
  // eager, or Commander silently stops knowing a command exists - help loses an entry and the
  // command stops being dispatchable, with no error anywhere. The weak three-substring check
  // above would not notice. This enumerates every registration and every option instead, so
  // moving one into a lazy module fails here rather than in a user's shell.
  it.each([
    [
      "",
      [
        "init",
        "status",
        "setup",
        "theme",
        "profile",
        "doctor",
        "font",
        "shell",
        "backup",
        "completion",
        "restore <backupId>",
      ],
    ],
    ["", ["-V, --version", "--no-color", "-h, --help"]],
    ["theme", ["list", "preview", "apply", "validate", "create", "edit", "remove"]],
    ["theme apply", ["--dry-run"]],
    ["theme edit", ["--set <role=value>", "--dry-run"]],
    ["profile apply", ["--dry-run"]],
    ["completion", ["powershell", "values <kind>"]],
    ["theme create", ["--id <id>", "--name <name>", "--from <themeId>", "--description <text>"]],
    ["theme create", ["--overwrite"]],
    ["profile", ["list", "show", "apply", "import", "export", "remove"]],
    ["profile import", ["--overwrite"]],
    ["profile export", ["--output <path>", "--overwrite"]],
    ["font", ["list", "check <family>", "install [options] <path>"]],
    ["font install", ["--yes"]],
    ["shell", ["status", "init", "remove"]],
    ["shell init", ["--yes"]],
    ["shell remove", ["--yes"]],
    // `restore` exists both at the top level and under `backup`. Anyone holding an id from
    // `backup list` reaches for `backup restore <id>`, which used to be an unknown command.
    ["backup", ["list", "create", "restore <backupId>"]],
    ["setup", ["--yes"]],
  ])("`%s --help` still registers %j despite lazy module loading", (group, expected) => {
    const args = group === "" ? ["--help"] : [...group.split(" "), "--help"];
    const { stdout, status } = runCli(args);
    expect(status).toBe(0);
    for (const entry of expected) expect(stdout).toContain(entry);
  });

  it("lists built-in themes", () => {
    const { stdout, status } = runCli(["theme", "list"]);
    expect(status).toBe(0);
    expect(stdout).toContain("ghost-protocol");
    expect(stdout).toContain("monolith");
    expect(stdout).toContain("redline");
    expect(stdout).toContain("deep-space");
  });

  it("previews a theme", () => {
    const { stdout, status } = runCli(["theme", "preview", "ghost-protocol"]);
    expect(status).toBe(0);
    expect(stdout).toContain("Ghost Protocol");
  });

  it("reports an error for an unknown theme id", () => {
    const { status } = runCli(["theme", "preview", "does-not-exist"]);
    expect(status).not.toBe(0);
  });

  it("runs the doctor command", () => {
    const { stdout, status } = runCli(["doctor"]);
    expect(status).toBe(0);
    expect(stdout).toContain("Node.js version");
  });

  // Font detection reads the machine's real font directories, so these assert on fonts that
  // ship with every Windows install (Consolas, Courier New) rather than on anything a developer
  // may have added. The deterministic parsing and heuristic coverage is in
  // tests/unit/fonts.test.ts, driven against fixture directories.
  it("lists font families actually installed on this machine", () => {
    const { stdout, status } = runCli(["font", "list"]);
    expect(status).toBe(0);
    expect(stdout).toContain("font families installed");
    expect(stdout).toContain("Consolas");
    expect(stdout).toContain("Courier New");
    // The Nerd Font column must be labelled as a name-based guess wherever it is rendered.
    expect(stdout).toContain("heuristic");
  });

  it("exits 0 for an installed font family", () => {
    const { stdout, status } = runCli(["font", "check", "Consolas"]);
    expect(status).toBe(0);
    expect(stdout).toContain("Consolas");
    expect(stdout).toContain("installed");
  });

  it("exits 1 for a font family that is not installed", () => {
    const { status } = runCli(["font", "check", "definitely-not-a-font"]);
    expect(status).toBe(1);
  });

  it("lists bundled profiles", () => {
    const { stdout, status } = runCli(["profile", "list"]);
    expect(status).toBe(0);
    expect(stdout).toContain("ghost-protocol-default");
  });

  it("exits promptly instead of hanging when run with no args in a non-TTY context", () => {
    const start = Date.now();
    const stdout = execFileSync(process.execPath, [cliEntry], {
      encoding: "utf8",
      input: "",
      timeout: 5000,
    });
    expect(Date.now() - start).toBeLessThan(5000);
    expect(stdout).toContain("Non-interactive environment detected");
  });

  it("shows a profile's details", () => {
    const { stdout, status } = runCli(["profile", "show", "ghost-protocol-default"]);
    expect(status).toBe(0);
    expect(stdout).toContain("ghost-protocol-default");
    expect(stdout).toContain("Ghost Protocol");
  });

  it("reports an error for an unknown profile id in show", () => {
    const { status } = runCli(["profile", "show", "does-not-exist"]);
    expect(status).not.toBe(0);
  });
});

describe("CLI profile import/export/apply (isolated environment)", () => {
  let tmpRoot: string;
  let env: Record<string, string | undefined>;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-cli-profile-"));
    const localAppData = path.join(tmpRoot, "LocalAppData");
    const appData = path.join(tmpRoot, "AppData");
    const pkgDir = path.join(
      localAppData,
      "Packages",
      "Microsoft.WindowsTerminal_8wekyb3d8bbwe",
      "LocalState",
    );
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "settings.json"),
      JSON.stringify({ profiles: { defaults: {} } }),
    );

    env = { ...process.env, LOCALAPPDATA: localAppData, APPDATA: appData };
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("imports, lists, exports, and removes a user profile end to end", () => {
    const sourceFile = path.join(tmpRoot, "custom.json");
    fs.writeFileSync(
      sourceFile,
      JSON.stringify({
        id: "cli-custom",
        schemaVersion: "1.0",
        name: "CLI Custom",
        themeId: "redline",
      }),
    );

    const imported = runCli(["profile", "import", sourceFile], env);
    expect(imported.status).toBe(0);

    const listed = runCli(["profile", "list"], env);
    expect(listed.stdout).toContain("cli-custom");

    const exportPath = path.join(tmpRoot, "exported.json");
    const exported = runCli(["profile", "export", "cli-custom", "--output", exportPath], env);
    expect(exported.status).toBe(0);
    expect(fs.existsSync(exportPath)).toBe(true);

    const removed = runCli(["profile", "remove", "cli-custom"], env);
    expect(removed.status).toBe(0);
    expect(runCli(["profile", "list"], env).stdout).not.toContain("cli-custom");
  });

  it("applies a profile and reports it as active afterward", () => {
    const applied = runCli(["profile", "apply", "ghost-protocol-default"], env);
    expect(applied.status).toBe(0);
    expect(applied.stdout).toContain("Ghost Protocol");

    const status = runCli(["status"], env);
    expect(status.stdout).toContain("Ghost Protocol");
  });
});

/**
 * `doctor`'s font check, in both states, driven from an isolated APPDATA.
 *
 * The condition this names is a real silent failure: `theme apply` writes the theme's
 * `typography.family` into Windows Terminal's `profiles.defaults.font.face`, Windows Terminal
 * substitutes a default when that family is not installed, and NIGHTSHIFT reported success
 * regardless. The active theme is set by writing config.json directly rather than running
 * `theme apply`, which would write the developer's real Windows Terminal settings.json.
 */
describe("CLI doctor font check (isolated environment)", () => {
  let tmpRoot: string;
  let nightshiftRoot: string;
  let env: Record<string, string | undefined>;

  const palette = {
    background: "#0A0D0B",
    foreground: "#DCE6DF",
    primary: "#65E58B",
    secondary: "#87938B",
    success: "#65E58B",
    warning: "#E8B45C",
    error: "#F06464",
    selection: "#24432E",
    cursor: "#65E58B",
  };
  const ansi = Object.fromEntries(
    [
      "black",
      "red",
      "green",
      "yellow",
      "blue",
      "purple",
      "cyan",
      "white",
      "brightBlack",
      "brightRed",
      "brightGreen",
      "brightYellow",
      "brightBlue",
      "brightPurple",
      "brightCyan",
      "brightWhite",
    ].map((key) => [key, "#808080"]),
  );

  /**
   * `renderTable` wraps the Detail column, so a phrase being asserted on can be split across
   * table rows by a border and padding. Collapsing borders and runs of whitespace keeps these
   * assertions about the words `doctor` says rather than about where the terminal happened to
   * wrap them.
   */
  function flatten(stdout: string): string {
    return stdout.replace(/[│├┤┌┐└┘─┬┴┼]/g, " ").replace(/\s+/g, " ");
  }

  function setActiveTheme(themeId: string): void {
    fs.writeFileSync(
      path.join(nightshiftRoot, "config.json"),
      JSON.stringify({
        schemaVersion: "1.0",
        activeThemeId: themeId,
        activeProfileId: null,
        initializedAt: new Date(0).toISOString(),
      }),
    );
  }

  function writeUserTheme(id: string, family: string | undefined): void {
    const themesDir = path.join(nightshiftRoot, "themes");
    fs.mkdirSync(themesDir, { recursive: true });
    fs.writeFileSync(
      path.join(themesDir, `${id}.json`),
      JSON.stringify({
        id,
        schemaVersion: "1.0",
        name: id,
        colors: palette,
        ansi,
        ...(family === undefined ? {} : { typography: { family, size: 14 } }),
      }),
    );
  }

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-cli-doctor-font-"));
    nightshiftRoot = path.join(tmpRoot, "AppData", "nightshift");
    fs.mkdirSync(nightshiftRoot, { recursive: true });
    env = { ...process.env, APPDATA: path.join(tmpRoot, "AppData") };
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("reports the active theme's font as installed when it is", () => {
    // `redline` ships asking for Consolas, which is present on every Windows install.
    setActiveTheme("redline");

    const { stdout, status } = runCli(["doctor"], env);
    const detail = flatten(stdout);

    expect(status).toBe(0);
    expect(detail).toContain("Theme font");
    expect(detail).toContain('redline requests "Consolas" - installed');
    expect(detail).not.toContain("not installed");
  });

  it("names the missing font instead of reporting a clean bill of health", () => {
    writeUserTheme("ghost-missing-font", "NIGHTSHIFT No Such Font");
    setActiveTheme("ghost-missing-font");

    const { stdout, status } = runCli(["doctor"], env);
    const detail = flatten(stdout);

    expect(detail).toContain("Theme font");
    expect(detail).toContain('requests "NIGHTSHIFT No Such Font", which is not installed');
    expect(detail).toContain("silently substitute");
    // A missing font is advisory, like a low-contrast palette: it must not break `doctor` as a
    // scripted health gate (docs/ARCHITECTURE.md, "doctor exits non-zero only for a fail").
    expect(status).toBe(0);
  });

  it("treats a theme with no typography block as requesting no font, not as a problem", () => {
    // `typography` is optional in themeSchema; absence is not a failure.
    writeUserTheme("ghost-no-typography", undefined);
    setActiveTheme("ghost-no-typography");

    const { stdout, status } = runCli(["doctor"], env);
    const detail = flatten(stdout);

    expect(status).toBe(0);
    expect(detail).toContain("requests no specific font family");
    expect(detail).not.toContain("not installed");
  });
});
