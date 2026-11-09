import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createBackup, listBackups, restoreBackup } from "../../src/backup/manager.js";

describe("backup and restore", () => {
  let tmpRoot: string;
  let targetFile: string;
  let originalAppData: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-backup-"));
    originalAppData = process.env.APPDATA;
    process.env.APPDATA = path.join(tmpRoot, "appdata");
    targetFile = path.join(tmpRoot, "settings.json");
    fs.writeFileSync(targetFile, JSON.stringify({ original: true }));
  });

  afterEach(() => {
    process.env.APPDATA = originalAppData;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("creates a backup and restores the original content after a mutation", () => {
    const backup = createBackup(targetFile, "test mutation");

    fs.writeFileSync(targetFile, JSON.stringify({ original: false, mutated: true }));
    expect(JSON.parse(fs.readFileSync(targetFile, "utf8")).mutated).toBe(true);

    restoreBackup(backup.id);
    const restored = JSON.parse(fs.readFileSync(targetFile, "utf8"));
    expect(restored).toEqual({ original: true });
  });

  it("lists both created backups", () => {
    const first = createBackup(targetFile, "first");
    const second = createBackup(targetFile, "second");
    const listed = listBackups();
    expect(listed).toHaveLength(2);
    expect(listed.some((b) => b.id === first.id)).toBe(true);
    expect(listed.some((b) => b.id === second.id)).toBe(true);
  });

  it("throws a clear error when restoring an unknown backup id", () => {
    expect(() => restoreBackup("does-not-exist")).toThrow(/No backup found/);
  });

  it("rejects a backup id containing a path traversal attempt", () => {
    expect(() => restoreBackup("../../etc/passwd")).toThrow();
  });
});
