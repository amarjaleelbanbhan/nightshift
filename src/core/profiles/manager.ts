import fs from "node:fs";
import path from "node:path";
import { safeParseProfile, type Profile } from "./schema.js";
import { getProfile, isBuiltinProfileId, userProfileFileExists } from "./registry.js";
import { getUserProfilesDir } from "../config/paths.js";
import { getTheme } from "../themes/registry.js";
import { resolveSafePath, assertNotSymlink } from "../../security/paths.js";
import { atomicWriteFileSync } from "../../utils/atomicWrite.js";
import { readConfig, writeConfig } from "../config/store.js";
import { MAX_JSON_FILE_BYTES } from "../../security/limits.js";

export interface ProfileFileResult {
  ok: boolean;
  message: string;
  profile?: Profile | undefined;
  path?: string | undefined;
}

export function importProfile(
  sourcePath: string,
  options: { overwrite?: boolean | undefined } = {},
): ProfileFileResult {
  const resolvedSource = path.resolve(process.cwd(), sourcePath);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolvedSource);
  } catch {
    return { ok: false, message: `No file found at "${sourcePath}".` };
  }
  if (!stat.isFile()) {
    return { ok: false, message: `"${sourcePath}" is not a regular file.` };
  }
  // Checked here rather than via readJsonFileWithLimit so import can report a friendly
  // message instead of throwing, and so the stat already taken for isFile() is reused.
  if (stat.size > MAX_JSON_FILE_BYTES) {
    return {
      ok: false,
      message: `"${sourcePath}" is ${stat.size} bytes, which exceeds the ${MAX_JSON_FILE_BYTES}-byte profile import limit.`,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(resolvedSource, "utf8"));
  } catch {
    return { ok: false, message: `"${sourcePath}" is not valid JSON.` };
  }

  const result = safeParseProfile(raw);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    return { ok: false, message: `Invalid profile:\n  ${issues.join("\n  ")}` };
  }
  const profile = result.data;

  if (!getTheme(profile.themeId)) {
    return {
      ok: false,
      message: `Profile "${profile.id}" references theme "${profile.themeId}", which does not exist.`,
    };
  }

  if (isBuiltinProfileId(profile.id)) {
    return {
      ok: false,
      message: `"${profile.id}" is a built-in profile id and cannot be overwritten.`,
    };
  }

  const destDir = getUserProfilesDir();
  const destPath = resolveSafePath(destDir, `${profile.id}.json`);

  if (userProfileFileExists(profile.id) && !options.overwrite) {
    return {
      ok: false,
      message: `A user profile with id "${profile.id}" already exists. Re-run with --overwrite to replace it.`,
    };
  }

  try {
    assertNotSymlink(destPath);
    fs.mkdirSync(destDir, { recursive: true });
    atomicWriteFileSync(destPath, JSON.stringify(profile, null, 2));
  } catch (error) {
    return { ok: false, message: `Failed to write imported profile: ${(error as Error).message}` };
  }

  return { ok: true, message: `Imported profile "${profile.id}".`, profile, path: destPath };
}

export function exportProfile(
  id: string,
  options: { outputPath?: string | undefined; overwrite?: boolean | undefined } = {},
): ProfileFileResult {
  const entry = getProfile(id);
  if (!entry) {
    return { ok: false, message: `No profile found with id "${id}".` };
  }

  const result = safeParseProfile(entry.profile);
  if (!result.success) {
    return { ok: false, message: `Profile "${id}" failed re-validation before export.` };
  }

  const destPath = path.resolve(process.cwd(), options.outputPath ?? `${id}.json`);

  if (fs.existsSync(destPath) && !options.overwrite) {
    return {
      ok: false,
      message: `"${path.relative(process.cwd(), destPath)}" already exists. Re-run with --overwrite to replace it.`,
    };
  }

  try {
    assertNotSymlink(destPath);
    atomicWriteFileSync(destPath, JSON.stringify(result.data, null, 2));
  } catch (error) {
    return { ok: false, message: `Failed to export profile: ${(error as Error).message}` };
  }

  return {
    ok: true,
    message: `Exported "${id}" to "${destPath}".`,
    profile: result.data,
    path: destPath,
  };
}

export function removeProfile(id: string): ProfileFileResult {
  if (isBuiltinProfileId(id)) {
    return { ok: false, message: `"${id}" is a built-in profile and cannot be removed.` };
  }
  if (!userProfileFileExists(id)) {
    return { ok: false, message: `No user profile found with id "${id}".` };
  }

  const filePath = resolveSafePath(getUserProfilesDir(), `${id}.json`);

  // Read the config *before* unlinking (A-10). `readConfig()` throws on a corrupt config.json,
  // and with the unlink first that throw left the profile file already deleted and the config
  // still pointing at it - the one state this function exists to prevent. Reading first means a
  // corrupt config aborts the removal entirely instead of half-performing it.
  const config = readConfig();

  fs.unlinkSync(filePath);

  // Don't leave config pointing at a profile that no longer exists.
  if (config.activeProfileId === id) {
    writeConfig({ ...config, activeProfileId: null });
  }

  return { ok: true, message: `Removed profile "${id}".` };
}
