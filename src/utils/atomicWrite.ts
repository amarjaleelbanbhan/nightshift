import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Writes `content` by first writing to a temp file in the same directory
 * then renaming over the target. Rename is atomic on the same volume, so a
 * crash mid-write can never leave the target file truncated or corrupted.
 *
 * A `Buffer` is accepted as well as a string so binary writes (`font install` copying a font
 * file into the user font directory) get the same guarantee rather than a second write path.
 * `fs.writeFileSync` ignores the encoding argument for a Buffer.
 */
export function atomicWriteFileSync(targetPath: string, content: string | Buffer): void {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(targetPath)}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, targetPath);
}
