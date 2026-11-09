import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  listProfiles,
  getProfile,
  isBuiltinProfileId,
  inspectUserProfilesDirectory,
} from "../../src/core/profiles/registry.js";
import { getUserProfilesDir } from "../../src/core/config/paths.js";

describe("profile registry", () => {
  let tmpRoot: string;
  let originalAppData: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-profiles-"));
    originalAppData = process.env.APPDATA;
    process.env.APPDATA = tmpRoot;
  });

  afterEach(() => {
    process.env.APPDATA = originalAppData;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("lists bundled profiles when no user profiles exist", () => {
    const entries = listProfiles();
    expect(entries.every((e) => e.source === "builtin")).toBe(true);
    expect(entries.some((e) => e.profile.id === "ghost-protocol-default")).toBe(true);
  });

  it("includes a valid user profile tagged with source user", () => {
    const dir = getUserProfilesDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "my-redline.json"),
      JSON.stringify({ id: "my-redline", schemaVersion: "1.0", name: "My Redline", themeId: "redline" }),
    );

    const entry = listProfiles().find((e) => e.profile.id === "my-redline");
    expect(entry?.source).toBe("user");
  });

  it("does not let a user profile shadow a built-in profile with the same id", () => {
    const dir = getUserProfilesDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "ghost-protocol-default.json"),
      JSON.stringify({
        id: "ghost-protocol-default",
        schemaVersion: "1.0",
        name: "Imposter",
        themeId: "redline",
      }),
    );

    const entries = listProfiles().filter((e) => e.profile.id === "ghost-protocol-default");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.source).toBe("builtin");
    expect(entries[0]!.profile.name).toBe("Ghost Protocol (Default)");
  });

  it("looks up a profile by id regardless of source", () => {
    expect(getProfile("ghost-protocol-default")?.source).toBe("builtin");
    expect(getProfile("does-not-exist")).toBeUndefined();
  });

  it("identifies built-in profile ids", () => {
    expect(isBuiltinProfileId("ghost-protocol-default")).toBe(true);
    expect(isBuiltinProfileId("some-user-profile")).toBe(false);
  });

  it("reports invalid user profile files via inspectUserProfilesDirectory", () => {
    const dir = getUserProfilesDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "broken.json"), "{ not json");
    fs.writeFileSync(
      path.join(dir, "valid.json"),
      JSON.stringify({ id: "valid-one", schemaVersion: "1.0", name: "Valid", themeId: "monolith" }),
    );

    const report = inspectUserProfilesDirectory();
    expect(report.exists).toBe(true);
    expect(report.validCount).toBe(1);
    expect(report.invalid).toHaveLength(1);
    expect(report.invalid[0]!.file).toBe("broken.json");
  });
});
