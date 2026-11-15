import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  NightshiftError,
  describeError,
  EXIT_SUCCESS,
  EXIT_FAILURE,
  EXIT_CONFIG_CORRUPT,
} from "../../src/cli/errors.js";
import { ConfigCorruptError, tryReadConfig, readConfig } from "../../src/core/config/store.js";
import { FileTooLargeError, MAX_JSON_FILE_BYTES } from "../../src/security/limits.js";
import { getConfigFilePath } from "../../src/core/config/paths.js";

describe("exit-code contract", () => {
  it("keeps the documented numeric values (changing one breaks every script)", () => {
    expect(EXIT_SUCCESS).toBe(0);
    expect(EXIT_FAILURE).toBe(1);
    expect(EXIT_CONFIG_CORRUPT).toBe(2);
  });
});

describe("describeError", () => {
  it("uses a NightshiftError's own exit code and message", () => {
    expect(describeError(new NightshiftError("boom", EXIT_CONFIG_CORRUPT))).toEqual({
      message: "boom",
      exitCode: EXIT_CONFIG_CORRUPT,
    });
  });

  it("defaults a NightshiftError without an explicit code to the failure code", () => {
    expect(describeError(new NightshiftError("boom")).exitCode).toBe(EXIT_FAILURE);
  });

  it("maps a corrupt config to the config exit code", () => {
    const result = describeError(new ConfigCorruptError("C:/x/config.json", "(root): nope"));
    expect(result.exitCode).toBe(EXIT_CONFIG_CORRUPT);
    expect(result.message).toContain("C:/x/config.json");
    expect(result.message).toContain("nightshift init");
  });

  it("maps an oversized config file to the config exit code too", () => {
    expect(describeError(new FileTooLargeError("C:/x/config.json", 999999)).exitCode).toBe(
      EXIT_CONFIG_CORRUPT,
    );
  });

  it("maps any other Error to the generic failure code", () => {
    expect(describeError(new Error("plain"))).toEqual({ message: "plain", exitCode: EXIT_FAILURE });
  });

  it("survives a thrown non-Error value", () => {
    expect(describeError("just a string")).toEqual({
      message: "just a string",
      exitCode: EXIT_FAILURE,
    });
    expect(describeError(undefined)).toEqual({ message: "undefined", exitCode: EXIT_FAILURE });
  });
});

describe("tryReadConfig", () => {
  let tmpRoot: string;
  let originalAppData: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-errors-"));
    originalAppData = process.env.APPDATA;
    process.env.APPDATA = tmpRoot;
    fs.mkdirSync(path.dirname(getConfigFilePath()), { recursive: true });
  });

  afterEach(() => {
    process.env.APPDATA = originalAppData;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", () => {
    const result = tryReadConfig();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.activeThemeId).toBeNull();
  });

  it.each([
    ["invalid JSON", "{ not json"],
    ["an array at the root", "[]"],
    ["an object missing required fields", "{}"],
    ["valid JSON with the wrong types", '{"schemaVersion":"2.0","activeThemeId":5}'],
  ])("reports %s without throwing", (_label, body) => {
    fs.writeFileSync(getConfigFilePath(), body);

    const result = tryReadConfig();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ConfigCorruptError);
      // The message must name the file and the remedy - that is the whole point of it.
      expect(result.error.message).toContain(getConfigFilePath());
      expect(result.error.message).toContain("nightshift init");
      // And it must not be a raw parser/validator dump.
      expect(result.error.message).not.toContain("ZodError");
      expect(result.error.message).not.toContain("    at ");
    }
  });

  it("passes an oversized config through as FileTooLargeError, not wrapped", () => {
    fs.writeFileSync(
      getConfigFilePath(),
      JSON.stringify({
        schemaVersion: "1.0",
        activeThemeId: null,
        activeProfileId: null,
        initializedAt: new Date().toISOString(),
        pad: "x".repeat(MAX_JSON_FILE_BYTES + 1024),
      }),
    );

    const result = tryReadConfig();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(FileTooLargeError);
  });

  it("readConfig throws what tryReadConfig reports, so writers cannot proceed on a broken config", () => {
    fs.writeFileSync(getConfigFilePath(), "[]");
    expect(() => readConfig()).toThrow(ConfigCorruptError);
    try {
      readConfig();
      expect.unreachable("readConfig should have thrown");
    } catch (error) {
      expect(describeError(error).exitCode).toBe(EXIT_CONFIG_CORRUPT);
    }
  });
});
