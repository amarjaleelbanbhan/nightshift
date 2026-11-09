import os from "node:os";
import path from "node:path";

/** Resolves NIGHTSHIFT's own config/data root. Does not create it. */
export function getNightshiftRoot(): string {
  const platform = os.platform();
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "nightshift");
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "nightshift");
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(xdgConfig, "nightshift");
}

export function getConfigFilePath(): string {
  return path.join(getNightshiftRoot(), "config.json");
}

export function getUserThemesDir(): string {
  return path.join(getNightshiftRoot(), "themes");
}

export function getBackupsDir(): string {
  return path.join(getNightshiftRoot(), "backups");
}

export function getUserProfilesDir(): string {
  return path.join(getNightshiftRoot(), "profiles");
}
