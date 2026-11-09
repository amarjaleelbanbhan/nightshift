import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Writes `content` by first writing to a temp file in the same directory
 * then renaming over the target. Rename is atomic on the same volume, so a
 * crash mid-write can never leave the target file truncated or corrupted.
 */
export function atomicWriteFileSync(targetPath: string, content: string): void {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(targetPath)}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, targetPath);
}
