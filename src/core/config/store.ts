import fs from "node:fs";
import { z } from "zod";
import { getConfigFilePath } from "./paths.js";
import { atomicWriteFileSync } from "../../utils/atomicWrite.js";

const configSchema = z.object({
  schemaVersion: z.literal("1.0"),
  activeThemeId: z.string().nullable(),
  initializedAt: z.string(),
});

export type NightshiftConfig = z.infer<typeof configSchema>;

const defaultConfig: NightshiftConfig = {
  schemaVersion: "1.0",
  activeThemeId: null,
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
    initializedAt: new Date().toISOString(),
  };
  writeConfig(config);
  return config;
}

export function setActiveTheme(themeId: string): NightshiftConfig {
  const config = { ...readConfig(), activeThemeId: themeId };
  writeConfig(config);
  return config;
}
