import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.resolve(__dirname, "../../dist/index.js");

function runCli(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [cliEntry, ...args], { encoding: "utf8" });
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
});
