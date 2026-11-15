import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

  /**
   * Backup ids are `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`, and the entry directory
   * is created with `mkdirSync(..., { recursive: true })`, which does **not** throw on an
   * existing path. So a duplicate id would not error - it would silently overwrite the earlier
   * backup's snapshot and metadata, and `restore` would hand back the wrong file.
   *
   * The millisecond alone is not enough: the apply engine takes a backup immediately before a
   * write, and nothing stops two backups landing in the same millisecond. The 32 bits of UUID
   * are what actually carry uniqueness there, so that is what is tested - with the clock pinned,
   * because on a real clock these calls take >1ms each and the timestamp would do all the work,
   * leaving the suffix untested. (The suffix narrows a collision to ~1 in 4.3e9 within one
   * millisecond; this is not a demonstrated flaw, it is the property being held in place.)
   */
  describe("backup id uniqueness within a single millisecond", () => {
    const FIXED = new Date("2026-03-04T05:06:07.008Z");

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(FIXED);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("gives 50 same-millisecond backups 50 distinct, independently restorable snapshots", () => {
      const made: Array<{ id: string; content: string }> = [];
      for (let i = 0; i < 50; i += 1) {
        const content = JSON.stringify({ generation: i });
        fs.writeFileSync(targetFile, content);
        made.push({ id: createBackup(targetFile, `generation ${i}`).id, content });
      }

      // Non-vacuity guard: if the clock were not actually pinned these prefixes would differ
      // and the test would be measuring Date.now() rather than the random suffix.
      const prefixes = new Set(made.map((m) => m.id.split("-")[0]));
      expect(prefixes.size).toBe(1);
      expect([...prefixes][0]).toBe(String(FIXED.getTime()));

      expect(new Set(made.map((m) => m.id)).size).toBe(50);
      expect(made.every((m) => /^\d+-[0-9a-f]{8}$/.test(m.id))).toBe(true);
      expect(listBackups()).toHaveLength(50);

      // The real assertion: no entry directory was reused, so every snapshot still holds the
      // content that was on disk when it was taken.
      for (const { id, content } of made) {
        fs.writeFileSync(targetFile, "CLOBBERED");
        expect(restoreBackup(id).id).toBe(id);
        expect(fs.readFileSync(targetFile, "utf8")).toBe(content);
      }
    });

    it("lists every same-millisecond backup even though createdAt cannot order them", () => {
      // `listBackups` sorts on `createdAt`, which is millisecond-resolution, so these are all
      // equal and the order between them is not meaningful. That is acceptable only because
      // `restore` takes an explicit id - what would not be acceptable is losing entries.
      const ids = [1, 2, 3].map((i) => createBackup(targetFile, `r${i}`).id);

      const listed = listBackups();
      expect(new Set(listed.map((b) => b.createdAt)).size).toBe(1);
      expect(listed.map((b) => b.id).sort()).toEqual([...ids].sort());
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

  describe("redirected restore destination (#23)", () => {
    /**
     * The destination comes out of `metadata.json`, so a poisoned `originalPath` steers the
     * write even though that file is Zod-validated and symlink-checked. Automatic rollbacks run
     * without the user asking for them, so they pass the path they backed up and the write is
     * refused when the two disagree.
     */
    function poisonDestination(id: string, destination: string): void {
      poison(
        id,
        JSON.stringify({
          id,
          createdAt: new Date().toISOString(),
          originalPath: destination,
          reason: "reason",
        }),
      );
    }

    it("refuses when metadata points somewhere the caller did not ask for", () => {
      const elsewhere = path.join(tmpRoot, "elsewhere.json");
      const backup = createBackup(targetFile, "reason");
      poisonDestination(backup.id, elsewhere);

      expect(() => restoreBackup(backup.id, targetFile)).toThrow(/did not ask for/);
      expect(fs.existsSync(elsewhere)).toBe(false);
    });

    it("restores when metadata and the caller agree, modulo path spelling", () => {
      const backup = createBackup(targetFile, "reason");
      fs.writeFileSync(targetFile, "CHANGED");
      // Same file, differently spelled: the comparison resolves both sides rather than
      // comparing strings, so a `.` segment is not mistaken for a redirect.
      const indirect = path.join(path.dirname(targetFile), ".", path.basename(targetFile));

      expect(restoreBackup(backup.id, indirect).id).toBe(backup.id);
      expect(JSON.parse(fs.readFileSync(targetFile, "utf8"))).toEqual({ original: true });
    });

    it("still restores from metadata alone when no destination is expected", () => {
      // `backup restore <id>` is "put it back where it came from", so the metadata path is the
      // request, not an input to be second-guessed. It is printed before the write instead.
      const backup = createBackup(targetFile, "reason");
      fs.writeFileSync(targetFile, "CHANGED");

      expect(restoreBackup(backup.id).originalPath).toBe(targetFile);
      expect(JSON.parse(fs.readFileSync(targetFile, "utf8"))).toEqual({ original: true });
    });
  });
});
