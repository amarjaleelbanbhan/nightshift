import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.resolve(__dirname, "../../dist/index.js");

function runCli(args: string[], env: Record<string, string | undefined> = process.env): {
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

  it("lists bundled profiles", () => {
    const { stdout, status } = runCli(["profile", "list"]);
    expect(status).toBe(0);
    expect(stdout).toContain("ghost-protocol-default");
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
    fs.writeFileSync(path.join(pkgDir, "settings.json"), JSON.stringify({ profiles: { defaults: {} } }));

    env = { ...process.env, LOCALAPPDATA: localAppData, APPDATA: appData };
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("imports, lists, exports, and removes a user profile end to end", () => {
    const sourceFile = path.join(tmpRoot, "custom.json");
    fs.writeFileSync(
      sourceFile,
      JSON.stringify({ id: "cli-custom", schemaVersion: "1.0", name: "CLI Custom", themeId: "redline" }),
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
