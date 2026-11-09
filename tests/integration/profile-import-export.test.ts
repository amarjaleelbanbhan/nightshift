import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { importProfile, exportProfile, removeProfile } from "../../src/core/profiles/manager.js";
import { getUserProfilesDir } from "../../src/core/config/paths.js";
import { readConfig } from "../../src/core/config/store.js";

function writeSourceFile(dir: string, name: string, content: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

describe("profile import", () => {
  let appDataRoot: string;
  let sourceDir: string;
  let originalAppData: string | undefined;
  let originalCwd: string;

  beforeEach(() => {
    appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-import-appdata-"));
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-import-src-"));
    originalAppData = process.env.APPDATA;
    process.env.APPDATA = appDataRoot;
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.env.APPDATA = originalAppData;
    process.chdir(originalCwd);
    fs.rmSync(appDataRoot, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  it("imports a valid profile", () => {
    const file = writeSourceFile(
      sourceDir,
      "ok.json",
      JSON.stringify({ id: "my-profile", schemaVersion: "1.0", name: "My Profile", themeId: "ghost-protocol" }),
    );
    const result = importProfile(file);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(getUserProfilesDir(), "my-profile.json"))).toBe(true);
  });

  it("rejects malformed JSON", () => {
    const file = writeSourceFile(sourceDir, "bad.json", "{ not json");
    expect(importProfile(file).ok).toBe(false);
  });

  it("rejects a profile missing required fields", () => {
    const file = writeSourceFile(sourceDir, "missing.json", JSON.stringify({ id: "bad", schemaVersion: "1.0" }));
    expect(importProfile(file).ok).toBe(false);
  });

  it("rejects an invalid profile id", () => {
    const file = writeSourceFile(
      sourceDir,
      "badid.json",
      JSON.stringify({ id: "Not Valid!", schemaVersion: "1.0", name: "x", themeId: "ghost-protocol" }),
    );
    expect(importProfile(file).ok).toBe(false);
  });

  it("rejects a reference to an unknown theme", () => {
    const file = writeSourceFile(
      sourceDir,
      "unknowntheme.json",
      JSON.stringify({ id: "x", schemaVersion: "1.0", name: "x", themeId: "nonexistent-theme" }),
    );
    expect(importProfile(file).ok).toBe(false);
  });

  it("rejects unexpected extra fields", () => {
    const file = writeSourceFile(
      sourceDir,
      "extra.json",
      JSON.stringify({ id: "x", schemaVersion: "1.0", name: "x", themeId: "ghost-protocol", widgets: [] }),
    );
    expect(importProfile(file).ok).toBe(false);
  });

  it("rejects an oversized file before even attempting to parse it", () => {
    const file = path.join(sourceDir, "huge.json");
    fs.writeFileSync(file, "x".repeat(200 * 1024));
    const result = importProfile(file);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/exceeds/);
  });

  it("rejects a duplicate id without --overwrite, then succeeds with it", () => {
    const file = writeSourceFile(
      sourceDir,
      "dup.json",
      JSON.stringify({ id: "dup-profile", schemaVersion: "1.0", name: "First", themeId: "ghost-protocol" }),
    );
    expect(importProfile(file).ok).toBe(true);
    expect(importProfile(file).ok).toBe(false);
    expect(importProfile(file, { overwrite: true }).ok).toBe(true);
  });

  it("never allows overwriting a built-in profile id even with --overwrite", () => {
    const file = writeSourceFile(
      sourceDir,
      "builtin-clash.json",
      JSON.stringify({
        id: "ghost-protocol-default",
        schemaVersion: "1.0",
        name: "Imposter",
        themeId: "redline",
      }),
    );
    expect(importProfile(file).ok).toBe(false);
    expect(importProfile(file, { overwrite: true }).ok).toBe(false);
  });

  it("rejects importing a directory instead of a file", () => {
    const dirAsSource = path.join(sourceDir, "a-directory");
    fs.mkdirSync(dirAsSource);
    expect(importProfile(dirAsSource).ok).toBe(false);
  });

  it("rejects writing through a destination that is currently a symlink", () => {
    const file = writeSourceFile(
      sourceDir,
      "target.json",
      JSON.stringify({ id: "symlinked", schemaVersion: "1.0", name: "x", themeId: "ghost-protocol" }),
    );
    const destDir = getUserProfilesDir();
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, "symlinked.json");
    const decoyTarget = path.join(sourceDir, "decoy.json");
    fs.writeFileSync(decoyTarget, "{}");

    let symlinkSupported = true;
    try {
      fs.symlinkSync(decoyTarget, destPath);
    } catch {
      symlinkSupported = false;
    }
    if (!symlinkSupported) return; // this environment can't create symlinks without elevated privilege

    expect(importProfile(file).ok).toBe(false);
  });
});

describe("profile export", () => {
  let appDataRoot: string;
  let outDir: string;
  let originalAppData: string | undefined;
  let originalCwd: string;

  beforeEach(() => {
    appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-export-appdata-"));
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-export-out-"));
    originalAppData = process.env.APPDATA;
    process.env.APPDATA = appDataRoot;
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.env.APPDATA = originalAppData;
    process.chdir(originalCwd);
    fs.rmSync(appDataRoot, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("exports a built-in profile", () => {
    const output = path.join(outDir, "out.json");
    const result = exportProfile("ghost-protocol-default", { outputPath: output });
    expect(result.ok).toBe(true);
    const written = JSON.parse(fs.readFileSync(output, "utf8"));
    expect(written.id).toBe("ghost-protocol-default");
  });

  it("exports a user profile", () => {
    importProfile(
      (() => {
        const p = path.join(outDir, "src.json");
        fs.writeFileSync(
          p,
          JSON.stringify({ id: "exportable", schemaVersion: "1.0", name: "Exportable", themeId: "redline" }),
        );
        return p;
      })(),
    );
    const output = path.join(outDir, "exported.json");
    const result = exportProfile("exportable", { outputPath: output });
    expect(result.ok).toBe(true);
  });

  it("uses a default filename when no --output is given", () => {
    process.chdir(outDir);
    const result = exportProfile("ghost-protocol-default");
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(outDir, "ghost-protocol-default.json"))).toBe(true);
  });

  it("refuses to overwrite an existing file without --overwrite", () => {
    const output = path.join(outDir, "exists.json");
    fs.writeFileSync(output, "{}");
    const result = exportProfile("ghost-protocol-default", { outputPath: output });
    expect(result.ok).toBe(false);
  });

  it("overwrites when --overwrite is passed", () => {
    const output = path.join(outDir, "exists2.json");
    fs.writeFileSync(output, "{}");
    const result = exportProfile("ghost-protocol-default", { outputPath: output, overwrite: true });
    expect(result.ok).toBe(true);
  });

  it("fails cleanly for an unknown profile id", () => {
    const result = exportProfile("does-not-exist", { outputPath: path.join(outDir, "x.json") });
    expect(result.ok).toBe(false);
  });

  it("does not mutate NIGHTSHIFT's active configuration", () => {
    const before = readConfig();
    exportProfile("ghost-protocol-default", { outputPath: path.join(outDir, "noop.json") });
    const after = readConfig();
    expect(after).toEqual(before);
  });
});

describe("profile remove", () => {
  let appDataRoot: string;
  let sourceDir: string;
  let originalAppData: string | undefined;

  beforeEach(() => {
    appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-remove-appdata-"));
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-remove-src-"));
    originalAppData = process.env.APPDATA;
    process.env.APPDATA = appDataRoot;
  });

  afterEach(() => {
    process.env.APPDATA = originalAppData;
    fs.rmSync(appDataRoot, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  it("removes a user profile", () => {
    const file = writeSourceFile(
      sourceDir,
      "rm.json",
      JSON.stringify({ id: "removable", schemaVersion: "1.0", name: "Removable", themeId: "ghost-protocol" }),
    );
    importProfile(file);
    expect(fs.existsSync(path.join(getUserProfilesDir(), "removable.json"))).toBe(true);

    const result = removeProfile("removable");
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(getUserProfilesDir(), "removable.json"))).toBe(false);
  });

  it("refuses to remove a built-in profile", () => {
    expect(removeProfile("ghost-protocol-default").ok).toBe(false);
  });

  it("fails cleanly removing a profile that doesn't exist", () => {
    expect(removeProfile("never-existed").ok).toBe(false);
  });
});
