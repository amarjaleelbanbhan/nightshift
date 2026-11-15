import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { getBackupsDir } from "../core/config/paths.js";
import { resolveSafePath, assertNotSymlink } from "../security/paths.js";
import { readJsonFileWithLimit } from "../security/limits.js";
import { atomicWriteFileSync } from "../utils/atomicWrite.js";

/**
 * `metadata.json` is a file on disk under `%APPDATA%`, so it is an input like any other -
 * truncated by a full disk, hand-edited by a curious user, or left half-written by a crash.
 * It used to be read through an unvalidated `as BackupMetadata` cast (F-1), which produced
 * `TypeError: The "path" argument must be of type string` from inside `node:path` on restore
 * and, worse, an order-dependent `Cannot read properties of undefined (reading
 * 'localeCompare')` that took the whole `backup list` down.
 *
 * `restore` is the recovery command. It must not be the thing that breaks.
 */
const backupMetadataSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  originalPath: z.string().min(1),
  reason: z.string(),
});

export type BackupMetadata = z.infer<typeof backupMetadataSchema>;

/**
 * Snapshots `targetPath` into NIGHTSHIFT's backups directory before a
 * mutating operation (e.g. applying a theme to Windows Terminal settings).
 * Returns the backup id needed to restore it later.
 */
export function createBackup(targetPath: string, reason: string): BackupMetadata {
  const backupsDir = getBackupsDir();
  fs.mkdirSync(backupsDir, { recursive: true });

  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const entryDir = resolveSafePath(backupsDir, id);
  fs.mkdirSync(entryDir, { recursive: true });

  const originalExists = fs.existsSync(targetPath);
  const snapshotPath = path.join(entryDir, "snapshot" + path.extname(targetPath));
  if (originalExists) {
    fs.copyFileSync(targetPath, snapshotPath);
  }

  const metadata: BackupMetadata = {
    id,
    createdAt: new Date().toISOString(),
    originalPath: targetPath,
    reason,
  };
  atomicWriteFileSync(path.join(entryDir, "metadata.json"), JSON.stringify(metadata, null, 2));
  return metadata;
}

export function listBackups(): BackupMetadata[] {
  const backupsDir = getBackupsDir();
  if (!fs.existsSync(backupsDir)) return [];

  const entries: BackupMetadata[] = [];
  for (const id of fs.readdirSync(backupsDir)) {
    const metadataPath = path.join(backupsDir, id, "metadata.json");
    if (!fs.existsSync(metadataPath)) continue;
    try {
      // Validation is inside the try, with the read: a file that parses as JSON but is the
      // wrong shape used to reach the `.sort()` below and crash it on a missing `createdAt`.
      const parsed = backupMetadataSchema.safeParse(readJsonFileWithLimit(metadataPath));
      if (parsed.success) entries.push(parsed.data);
    } catch {
      // Skip unreadable or oversized backup entries rather than failing the whole listing -
      // one broken entry must not hide every good backup from the user.
    }
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Restores the file captured by `backupId` back to its original location. */
export function restoreBackup(backupId: string): BackupMetadata {
  const backupsDir = getBackupsDir();
  const entryDir = resolveSafePath(backupsDir, backupId);
  const metadataPath = path.join(entryDir, "metadata.json");

  if (!fs.existsSync(metadataPath)) {
    throw new Error(`No backup found with id "${backupId}"`);
  }
  const metadata = readBackupMetadata(metadataPath);

  const snapshotPath = path.join(entryDir, "snapshot" + path.extname(metadata.originalPath));
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(
      `Backup "${backupId}" has no snapshot (the original file did not exist when the backup was taken)`,
    );
  }
  // The restore destination comes out of a file, so it gets the same symlink check as every
  // other NIGHTSHIFT write target. `atomicWriteFileSync` renames over the target, which would
  // silently replace a symlink the user put there rather than following it.
  assertNotSymlink(metadata.originalPath);

  const content = fs.readFileSync(snapshotPath, "utf8");
  atomicWriteFileSync(metadata.originalPath, content);
  return metadata;
}

/**
 * Reads one `metadata.json`, refusing anything that is not a valid `BackupMetadata`.
 *
 * The message names the metadata file rather than just the id, because fixing or deleting that
 * file is the remedy, and the caller (`runRestore` in `src/cli/commands/backup.ts`) attaches
 * the "run `nightshift backup list`" next step and rethrows.
 */
function readBackupMetadata(metadataPath: string): BackupMetadata {
  let raw: unknown;
  try {
    raw = readJsonFileWithLimit(metadataPath);
  } catch (error) {
    throw new Error(`Could not read "${metadataPath}": ${(error as Error).message}`);
  }

  const parsed = backupMetadataSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `"${metadataPath}" is not valid backup metadata (${issues}). ` +
        "Delete that backup directory, or fix the file by hand.",
    );
  }
  return parsed.data;
}
