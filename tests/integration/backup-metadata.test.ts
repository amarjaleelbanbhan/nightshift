import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createBackup, listBackups, restoreBackup } from "../../src/backup/manager.js";
import { MAX_JSON_FILE_BYTES } from "../../src/security/limits.js";

/**
 * F-1: `restoreBackup()` and `listBackups()` both read `metadata.json` through an unvalidated
 * `as BackupMetadata` cast. `restore` is the recovery command - it must not be the thing that
 * breaks - so a hand-edited or truncated metadata file has to produce a readable refusal
 * rather than a `TypeError` from deep inside `node:path`, or a crash that takes the whole
 * backup *listing* down with it.
 *
 * Poisoning `metadata.json` already requires the user's own write rights, so this is
 * robustness and defence in depth, not a privilege boundary.
 */

describe("backup metadata validation", () => {
  let tmpRoot: string;
  let backupsDir: string;
  let targetFile: string;
  let originalAppData: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-bk-meta-"));
    originalAppData = process.env.APPDATA;
    process.env.APPDATA = path.join(tmpRoot, "appdata");
    backupsDir = path.join(tmpRoot, "appdata", "nightshift", "backups");
    targetFile = path.join(tmpRoot, "settings.json");
    fs.writeFileSync(targetFile, JSON.stringify({ original: true }));
  });

  afterEach(() => {
    process.env.APPDATA = originalAppData;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function poison(id: string, content: string): void {
    fs.writeFileSync(path.join(backupsDir, id, "metadata.json"), content);
  }

  describe("restoreBackup", () => {
    it.each([
      ["an object missing every field", JSON.stringify({ hello: "world" })],
      ["a JSON array at the root", "[]"],
      ["a bare string", '"nope"'],
      ["a null originalPath", JSON.stringify({ originalPath: null })],
      [
        "a numeric originalPath",
        JSON.stringify({ id: "x", createdAt: "x", originalPath: 42, reason: "r" }),
      ],
      [
        "an empty originalPath",
        JSON.stringify({ id: "x", createdAt: "x", originalPath: "", reason: "r" }),
      ],
    ])("refuses metadata that is %s, naming the file", (_label, content) => {
      const backup = createBackup(targetFile, "reason");
      poison(backup.id, content);

      // The pre-fix failure was a TypeError out of node:path ("The \"path\" argument must be
      // of type string"), which names neither the backup nor the remedy.
      expect(() => restoreBackup(backup.id)).toThrow(/metadata\.json/);
      expect(() => restoreBackup(backup.id)).not.toThrow(TypeError);
    });

    it("refuses metadata that is not JSON at all, naming the file", () => {
      const backup = createBackup(targetFile, "reason");
      poison(backup.id, "{not json");
      expect(() => restoreBackup(backup.id)).toThrow(/metadata\.json/);
    });

    it("refuses an oversized metadata.json instead of reading it into memory", () => {
      const backup = createBackup(targetFile, "reason");
      poison(backup.id, `{"pad":"${"x".repeat(MAX_JSON_FILE_BYTES + 1)}"}`);
      expect(() => restoreBackup(backup.id)).toThrow(/exceeds/);
    });

    it("still restores a well-formed backup", () => {
      const backup = createBackup(targetFile, "reason");
      fs.writeFileSync(targetFile, JSON.stringify({ mutated: true }));
      const metadata = restoreBackup(backup.id);
      expect(metadata.originalPath).toBe(targetFile);
      expect(JSON.parse(fs.readFileSync(targetFile, "utf8"))).toEqual({ original: true });
    });
  });

  describe("listBackups", () => {
    it("skips a shape-broken metadata.json instead of crashing the whole listing", () => {
      // Pre-fix the `try` only covered JSON.parse; the `.sort()` comparator then did
      // `b.createdAt.localeCompare(...)` on an entry with no createdAt and threw
      // "Cannot read properties of undefined (reading 'localeCompare')" - order-dependent,
      // so a single hand-edited metadata file broke `nightshift backup list` at random.
      const good: string[] = [];
      for (let i = 0; i < 6; i += 1) good.push(createBackup(targetFile, `reason-${i}`).id);
      poison(good[0]!, JSON.stringify({ hello: 1 }));
      poison(good[5]!, JSON.stringify({ hello: 1 }));

      const listed = listBackups();
      expect(listed).toHaveLength(4);
      expect(listed.every((b) => typeof b.createdAt === "string")).toBe(true);
      expect(listed.map((b) => b.id)).not.toContain(good[0]);
    });

    it("skips an oversized metadata.json rather than failing the listing", () => {
      const keep = createBackup(targetFile, "keep").id;
      const huge = createBackup(targetFile, "huge").id;
      poison(huge, `{"pad":"${"x".repeat(MAX_JSON_FILE_BYTES + 1)}"}`);

      expect(listBackups().map((b) => b.id)).toEqual([keep]);
    });
  });

  describe("symlinked restore destination", () => {
    it("refuses to write through a symlinked originalPath", () => {
      const realFile = path.join(tmpRoot, "outside.json");
      fs.writeFileSync(realFile, "ORIGINAL");
      const link = path.join(tmpRoot, "link.json");
      try {
        fs.symlinkSync(realFile, link);
      } catch {
        // Creating a symlink on Windows needs Developer Mode or elevation. Skipping the
        // assertion is honest; claiming it passed would not be.
        return;
      }

      const backup = createBackup(targetFile, "reason");
      poison(
        backup.id,
        JSON.stringify({
          id: backup.id,
          createdAt: new Date().toISOString(),
          originalPath: link,
          reason: "reason",
        }),
      );

      expect(() => restoreBackup(backup.id)).toThrow(/resolves outside|symlink/i);
      expect(fs.readFileSync(realFile, "utf8")).toBe("ORIGINAL");
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    });
  });
});
