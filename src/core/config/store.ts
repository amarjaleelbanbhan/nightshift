import fs from "node:fs";
import { z } from "zod";
import { getConfigFilePath } from "./paths.js";
import { atomicWriteFileSync } from "../../utils/atomicWrite.js";
import { readJsonFileWithLimit, FileTooLargeError } from "../../security/limits.js";

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

/**
 * `config.json` exists but could not be turned into a config. Thrown rather than returned by
 * `readConfig()`; `src/cli/errors.ts` maps it to the documented config exit code. The message
 * names the file and the remedy, because a hand-edited `config.json` is an expected input -
 * the README tells users where it lives.
 */
export class ConfigCorruptError extends Error {
  constructor(configPath: string, detail: string) {
    super(
      `NIGHTSHIFT's configuration file could not be read: ${configPath}\n` +
        `  ${detail}\n` +
        "  Fix the file by hand, or delete it and run `nightshift init` to recreate it.",
    );
    this.name = "ConfigCorruptError";
  }
}

export type ConfigReadResult = { ok: true; config: NightshiftConfig } | { ok: false; error: Error };

export function isInitialized(): boolean {
  return fs.existsSync(getConfigFilePath());
}

/**
 * Reads the config without throwing. Read-only commands (`status`, `profile list`, `profile
 * show`) use this so they stay usable when `config.json` is the thing that is broken - those
 * are exactly the commands a user runs when something is wrong. They report the corruption
 * and degrade the active-theme/profile display to "none".
 *
 * Commands that must have a real config - anything that writes one back - use `readConfig()`,
 * which throws instead, because degrading to defaults there would overwrite the user's file
 * with invented values.
 */
export function tryReadConfig(): ConfigReadResult {
  const configPath = getConfigFilePath();
  if (!fs.existsSync(configPath)) {
    return { ok: true, config: defaultConfig };
  }

  let raw: unknown;
  try {
    raw = readJsonFileWithLimit(configPath);
  } catch (error) {
    // FileTooLargeError already names the file, the size, and the limit, so it is passed
    // through unwrapped - callers (and the security suite) can still tell an oversized
    // config apart from a malformed one.
    if (error instanceof FileTooLargeError) return { ok: false, error };
    return { ok: false, error: new ConfigCorruptError(configPath, (error as Error).message) };
  }

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n  ");
    return { ok: false, error: new ConfigCorruptError(configPath, issues) };
  }
  return { ok: true, config: parsed.data };
}

export function readConfig(): NightshiftConfig {
  const result = tryReadConfig();
  if (!result.ok) throw result.error;
  return result.config;
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
  const config: NightshiftConfig = {
    ...readConfig(),
    activeThemeId: themeId,
    activeProfileId: null,
  };
  writeConfig(config);
  return config;
}

/** Sets both active profile and theme in a single write, so profile apply never leaves them out of sync. */
export function setActiveProfileAndTheme(profileId: string, themeId: string): NightshiftConfig {
  const config: NightshiftConfig = {
    ...readConfig(),
    activeProfileId: profileId,
    activeThemeId: themeId,
  };
  writeConfig(config);
  return config;
}
