import path from "node:path";
import fs from "node:fs";

export class UnsafePathError extends Error {
  constructor(attemptedPath: string, baseDir: string) {
    super(`Path "${attemptedPath}" resolves outside the allowed directory "${baseDir}"`);
    this.name = "UnsafePathError";
  }
}

/**
 * Resolves `candidate` relative to `baseDir` and throws if the result escapes
 * `baseDir`. Used whenever NIGHTSHIFT reads a user- or marketplace-supplied
 * file name (theme ids, import paths, backup ids) to prevent directory
 * traversal (e.g. "../../.ssh/config").
 */
export function resolveSafePath(baseDir: string, candidate: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, candidate);
  const relative = path.relative(resolvedBase, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new UnsafePathError(candidate, resolvedBase);
  }
  return resolvedTarget;
}

/**
 * Rejects symlinks at `targetPath` so a malicious marketplace asset cannot
 * point NIGHTSHIFT's writes at an arbitrary file via a symlinked config entry.
 */
export function assertNotSymlink(targetPath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(targetPath);
  } catch {
    return; // Doesn't exist yet - nothing to protect against.
  }
  if (stat.isSymbolicLink()) {
    throw new UnsafePathError(targetPath, path.dirname(targetPath));
  }
}
