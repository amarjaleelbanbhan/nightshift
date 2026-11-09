import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getBackupsDir } from "../core/config/paths.js";
import { resolveSafePath } from "../security/paths.js";
import { atomicWriteFileSync } from "../utils/atomicWrite.js";

export interface BackupMetadata {
  id: string;
  createdAt: string;
  originalPath: string;
  reason: string;
}

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
      const parsed = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as BackupMetadata;
      entries.push(parsed);
    } catch {
      // Skip corrupted backup entries rather than failing the whole listing.
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
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as BackupMetadata;

  const snapshotPath = path.join(entryDir, "snapshot" + path.extname(metadata.originalPath));
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(
      `Backup "${backupId}" has no snapshot (the original file did not exist when the backup was taken)`,
    );
  }
  const content = fs.readFileSync(snapshotPath, "utf8");
  atomicWriteFileSync(metadata.originalPath, content);
  return metadata;
}
