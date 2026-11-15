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

/**
 * Cap on one font file accepted by `font install`. Separate from the JSON cap because the two
 * are not the same kind of file: a patched Nerd Font `.ttf` is routinely 2-5 MB and a `.ttc`
 * collection can exceed 20 MB, so the 64 KB JSON limit would refuse every real font, while a
 * cap is still needed because the file is read into memory to be written atomically.
 */
export const MAX_FONT_FILE_BYTES = 32 * 1024 * 1024;

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
