import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import { resolveSafePath, UnsafePathError } from "../../src/security/paths.js";

describe("resolveSafePath", () => {
  const base = path.join(os.tmpdir(), "nightshift-test-base");

  it("resolves a plain file name within the base directory", () => {
    const resolved = resolveSafePath(base, "theme.json");
    expect(resolved).toBe(path.join(base, "theme.json"));
  });

  it("rejects a relative traversal outside the base directory", () => {
    expect(() => resolveSafePath(base, "../../.ssh/authorized_keys")).toThrow(UnsafePathError);
  });

  it("rejects an absolute path escaping the base directory", () => {
    const absoluteEscape = os.platform() === "win32" ? "C:\\Windows\\System32\\drivers\\etc\\hosts" : "/etc/passwd";
    expect(() => resolveSafePath(base, absoluteEscape)).toThrow(UnsafePathError);
  });

  it("rejects a traversal disguised with extra segments", () => {
    expect(() => resolveSafePath(base, "subdir/../../outside.json")).toThrow(UnsafePathError);
  });
});
