import { describe, it, expect } from "vitest";
import { meetsNodeFloor, MIN_NODE_VERSION } from "../../src/cli/commands/doctor.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `doctor` previously compared `major >= 18` against `process.versions.node` inline, so it kept
 * reporting `ok` on Node 18 and 20 long after engines moved to >=22.12.0 - telling the user their
 * environment was fine while `npm install` refused it with EBADENGINE. An inline read of the
 * running version is untestable by construction, which is how it survived; these tests exist
 * because the comparison is now a pure function.
 */
describe("meetsNodeFloor", () => {
  it("rejects the versions the project used to claim support for", () => {
    expect(meetsNodeFloor("18.0.0")).toBe(false);
    expect(meetsNodeFloor("18.20.8")).toBe(false);
    expect(meetsNodeFloor("20.19.0")).toBe(false);
  });

  it("rejects 22.11.0 - above the old floor but below the testable one", () => {
    // The case a `major >= 22` shortcut would wrongly admit. vitest 5 declares
    // ^22.12.0 || ^24.0.0 || >=26.0.0, so 22.0.0-22.11.x cannot run this project's own suite.
    expect(meetsNodeFloor("22.0.0")).toBe(false);
    expect(meetsNodeFloor("22.11.0")).toBe(false);
    expect(meetsNodeFloor("22.11.99")).toBe(false);
  });

  it("accepts the exact floor", () => {
    expect(meetsNodeFloor("22.12.0")).toBe(true);
  });

  it("accepts everything above the floor", () => {
    expect(meetsNodeFloor("22.12.1")).toBe(true);
    expect(meetsNodeFloor("22.13.0")).toBe(true);
    expect(meetsNodeFloor("23.0.0")).toBe(true);
    expect(meetsNodeFloor("24.0.0")).toBe(true);
    expect(meetsNodeFloor("26.12.1")).toBe(true);
    expect(meetsNodeFloor("100.0.0")).toBe(true);
  });

  it("fails closed on input it cannot parse", () => {
    // Claiming support for a version we could not read would be worse than refusing it.
    for (const bad of ["", "22", "22.12", "not.a.version", "v22.12.0", "22.x.0"]) {
      expect(meetsNodeFloor(bad)).toBe(false);
    }
  });

  it("accepts a prerelease patch above the floor", () => {
    // process.versions.node is plain, but nightly/RC builds carry a suffix on the patch.
    expect(meetsNodeFloor("23.0.0-nightly")).toBe(true);
  });

  it("agrees with engines.node in package.json", () => {
    // The floor is necessarily duplicated between package.json, CI and this constant. This test
    // is the thing that stops them drifting again - drift is the whole defect being fixed here.
    const pkgPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "package.json",
    );
    const engines = JSON.parse(readFileSync(pkgPath, "utf8")).engines.node as string;
    expect(engines).toBe(`>=${MIN_NODE_VERSION}`);
  });

  it("considers the runtime actually running this suite to be supported", () => {
    // If this ever fails, the suite is running on a version the project does not support.
    expect(meetsNodeFloor(process.versions.node)).toBe(true);
  });
});
