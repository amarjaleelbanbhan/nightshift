import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeParseProfile, type Profile } from "./schema.js";
import { resolveSafePath } from "../../security/paths.js";
import { getUserProfilesDir } from "../config/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ProfileListEntry {
  profile: Profile;
  source: "builtin" | "user";
}

/** Bundled profiles directory shipped with the package (see package.json "files"). */
function getBundledProfilesDir(): string {
  return path.resolve(__dirname, "../../../profiles");
}

function loadProfilesFromDir(dir: string): Profile[] {
  if (!fs.existsSync(dir)) return [];

  const profiles: Profile[] = [];
  for (const fileName of fs.readdirSync(dir)) {
    if (!fileName.endsWith(".json")) continue;
    const filePath = resolveSafePath(dir, fileName);
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const result = safeParseProfile(raw);
      if (result.success) profiles.push(result.data);
    } catch {
      // Skip unreadable/malformed profile files rather than crashing the CLI.
    }
  }
  return profiles;
}

function loadBundledProfiles(): Profile[] {
  return loadProfilesFromDir(getBundledProfilesDir());
}

function loadUserProfiles(): Profile[] {
  return loadProfilesFromDir(getUserProfilesDir());
}

/**
 * Lists bundled and user profiles. A user profile whose id collides with a bundled one is
 * excluded (bundled wins) rather than silently shadowing it - import already rejects this
 * case up front, so reaching this point means a file was placed by hand.
 */
export function listProfiles(): ProfileListEntry[] {
  const bundled = loadBundledProfiles();
  const bundledIds = new Set(bundled.map((p) => p.id));

  const entries: ProfileListEntry[] = bundled.map((profile) => ({ profile, source: "builtin" }));
  for (const profile of loadUserProfiles()) {
    if (bundledIds.has(profile.id)) continue;
    entries.push({ profile, source: "user" });
  }
  return entries;
}

export function getProfile(id: string): ProfileListEntry | undefined {
  return listProfiles().find((entry) => entry.profile.id === id);
}

export function isBuiltinProfileId(id: string): boolean {
  return loadBundledProfiles().some((profile) => profile.id === id);
}

export function userProfileFileExists(id: string): boolean {
  const dir = getUserProfilesDir();
  return fs.existsSync(resolveSafePath(dir, `${id}.json`));
}

export interface UserProfileDirectoryReport {
  path: string;
  exists: boolean;
  validCount: number;
  invalid: Array<{ file: string; reason: string }>;
}

/** Used by `doctor` to surface unreadable/invalid user profile files that listProfiles() silently skips. */
export function inspectUserProfilesDirectory(): UserProfileDirectoryReport {
  const dir = getUserProfilesDir();
  const report: UserProfileDirectoryReport = { path: dir, exists: fs.existsSync(dir), validCount: 0, invalid: [] };
  if (!report.exists) return report;

  for (const fileName of fs.readdirSync(dir)) {
    if (!fileName.endsWith(".json")) continue;
    const filePath = resolveSafePath(dir, fileName);
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const result = safeParseProfile(raw);
      if (result.success) {
        report.validCount += 1;
      } else {
        report.invalid.push({ file: fileName, reason: result.error.issues[0]?.message ?? "schema validation failed" });
      }
    } catch (error) {
      report.invalid.push({ file: fileName, reason: (error as Error).message });
    }
  }
  return report;
}
