import fs from "node:fs";
import path from "node:path";

/**
 * Windows Terminal stores settings.json under a package-specific LocalState
 * folder when installed from the Microsoft Store, or under a flat
 * %LOCALAPPDATA%\Microsoft\WindowsTerminal folder for unpackaged/portable
 * builds. Both are real, documented install paths, so we check each rather
 * than assuming one.
 */
const CANDIDATE_SUFFIXES = [
  "Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json",
  "Packages/Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe/LocalState/settings.json",
  "Microsoft/WindowsTerminal/settings.json",
];

export function locateWindowsTerminalSettings(): string | null {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;

  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = path.join(localAppData, ...suffix.split("/"));
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
