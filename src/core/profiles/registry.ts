import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeParseProfile, type Profile } from "./schema.js";
import { resolveSafePath } from "../../security/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Bundled profiles directory shipped with the package (see package.json "files"). */
function getBundledProfilesDir(): string {
  return path.resolve(__dirname, "../../../profiles");
}

export function listProfiles(): Profile[] {
  const dir = getBundledProfilesDir();
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
