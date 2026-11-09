import fs from "node:fs";
import { z } from "zod";
import { getConfigFilePath } from "./paths.js";
import { atomicWriteFileSync } from "../../utils/atomicWrite.js";

const configSchema = z.object({
  schemaVersion: z.literal("1.0"),
  activeThemeId: z.string().nullable(),
  // .default(null) means 0.1.0 config files written before this field existed still parse,
  // with activeProfileId treated as null rather than failing validation.
  activeProfileId: z.string().nullable().default(null),
  initializedAt: z.string(),
});

export type NightshiftConfig = z.infer<typeof configSchema>;

const defaultConfig: NightshiftConfig = {
  schemaVersion: "1.0",
  activeThemeId: null,
  activeProfileId: null,
  initializedAt: new Date(0).toISOString(),
};

export function isInitialized(): boolean {
  return fs.existsSync(getConfigFilePath());
}

export function readConfig(): NightshiftConfig {
  const configPath = getConfigFilePath();
  if (!fs.existsSync(configPath)) {
    return defaultConfig;
  }
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return configSchema.parse(raw);
}

export function writeConfig(config: NightshiftConfig): void {
  atomicWriteFileSync(getConfigFilePath(), JSON.stringify(config, null, 2));
}

export function initializeConfig(): NightshiftConfig {
  const config: NightshiftConfig = {
    schemaVersion: "1.0",
    activeThemeId: null,
    activeProfileId: null,
    initializedAt: new Date().toISOString(),
  };
  writeConfig(config);
  return config;
}

/**
 * Applying a theme standalone (not through a profile) must clear activeProfileId -
 * otherwise `status`/`doctor` would keep reporting a profile as active after its theme
 * was overridden directly.
 */
export function setActiveTheme(themeId: string): NightshiftConfig {
  const config: NightshiftConfig = { ...readConfig(), activeThemeId: themeId, activeProfileId: null };
  writeConfig(config);
  return config;
}

/** Sets both active profile and theme in a single write, so profile apply never leaves them out of sync. */
export function setActiveProfileAndTheme(profileId: string, themeId: string): NightshiftConfig {
  const config: NightshiftConfig = { ...readConfig(), activeProfileId: profileId, activeThemeId: themeId };
  writeConfig(config);
  return config;
}
