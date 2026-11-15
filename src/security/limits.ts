import fs from "node:fs";

/**
 * Single size cap for every JSON file NIGHTSHIFT reads off disk: user themes, user and
 * bundled profiles, `config.json`, and profile imports. Generous for this kind of file (a
 * theme is ~1 KB, a profile a few hundred bytes) and tight enough that a multi-gigabyte
 * file can never be allocated.
 *
 * Deliberately one shared constant. Before this existed, profile import was the only read
 * with a cap, so `theme list` would happily try to allocate a 4 GB `themes/huge.json` and
 * an oversized `config.json` crashed every command (gap G9).
 */
export const MAX_JSON_FILE_BYTES = 64 * 1024;

export class FileTooLargeError extends Error {
  constructor(filePath: string, size: number) {
    super(
      `"${filePath}" is ${size} bytes, which exceeds the ${MAX_JSON_FILE_BYTES}-byte limit for NIGHTSHIFT JSON files.`,
    );
    this.name = "FileTooLargeError";
  }
}

/**
 * Reads and JSON-parses `filePath`, refusing anything over `MAX_JSON_FILE_BYTES`.
 *
 * The size is checked with `stat` *before* the read, so an oversized file is never read
 * into memory at all - checking after `readFileSync` would be no guard at all.
 */
export function readJsonFileWithLimit(filePath: string): unknown {
  const { size } = fs.statSync(filePath);
  if (size > MAX_JSON_FILE_BYTES) {
    throw new FileTooLargeError(filePath, size);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
