import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import {
  collectCompletionNodes,
  completionValues,
  powershellCompletionScript,
} from "../../src/cli/commands/completion.js";
import { listThemes } from "../../src/core/themes/registry.js";
import { listProfiles } from "../../src/core/profiles/registry.js";
import { createBackup, listBackups } from "../../src/backup/manager.js";

/**
 * `nightshift completion powershell` (#30).
 *
 * Three things are worth testing here and they are tested three different ways:
 *
 * 1. The emitted script is a real script - driven through the built binary, because an emitted
 *    script that is never printed by the actual command is not a feature.
 * 2. The dynamic values match the `list` commands, driven against a temp APPDATA rather than
 *    whatever the host happens to have - a hardcoded id list is the failure mode this feature
 *    exists to avoid, and a test comparing hardcoded ids would hide it.
 * 3. `completion`'s static import graph stays cheap. This runs on every Tab press, so the day
 *    someone adds a top-level `import { renderTable }` to this module is the day completion
 *    becomes 230 ms slower, silently. The assertion is on the graph, not on a timing, because a
 *    timing assertion on CI is a flaky test.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const cliEntry = path.join(repoRoot, "dist/index.js");

/** The built binary, so the test covers the real registration and not just the module. */
function runCli(args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync(process.execPath, [cliEntry, ...args], { encoding: "utf8", env });
}

/**
 * Every package name reachable from `entry` through *static* imports in the built output.
 *
 * Deliberately static-only: `completionValues` imports the registries dynamically precisely so
 * that emitting the script does not pay for zod, and counting those would defeat the purpose of
 * the assertion.
 */
function staticPackageImports(entry: string): Set<string> {
  const packages = new Set<string>();
  const seen = new Set<string>();

  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    const specifiers = [
      ...source.matchAll(/(?:^|\n)\s*(?:import|export)[^;]*?from\s*["']([^"']+)["']/g),
      ...source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g),
    ].map((match) => match[1] as string);

    for (const specifier of specifiers) {
      if (specifier.startsWith(".")) {
        visit(path.resolve(path.dirname(file), specifier));
      } else {
        packages.add(specifier);
      }
    }
  };

  visit(entry);
  return packages;
}

describe("nightshift completion powershell", () => {
  it("emits a PowerShell script with the registration call and the generated table", () => {
    const script = runCli(["completion", "powershell"]);

    expect(script).toContain("Register-ArgumentCompleter -Native -CommandName nightshift");
    expect(script).toContain("$NightshiftCompletions = @{");
    // The dynamic hook: the script asks the CLI for ids instead of carrying a list of its own.
    expect(script).toContain("nightshift completion values $node.Val");
    // Generated from the live Commander tree, so these are present only if the walk worked.
    expect(script).toContain("'theme apply' = @{ Sub = @(); Opt = @('--dry-run', '--help')");
    expect(script).toContain("Val = 'theme'");
    expect(script).toContain("'restore' = @{ Sub = @(); Opt = @('--help'); Val = 'backup' }");
  });

  it("maps each argument of the real command tree to the registry it draws from", () => {
    // Read back out of the script the shipped binary prints, so this covers the live Commander
    // tree rather than a reconstruction of it. Completion is derived from each argument's
    // *name*, so `<file>` and `<family>` arguments get nothing rather than theme ids.
    const script = runCli(["completion", "powershell"]);
    const values = new Map(
      [...script.matchAll(/^ {2}'([^']*)' = @\{ Sub = .*Val = '([^']*)' \}$/gm)].map((m) => [
        m[1] as string,
        m[2] as string,
      ]),
    );

    expect(values.get("theme apply")).toBe("theme");
    expect(values.get("theme preview")).toBe("theme");
    expect(values.get("theme remove")).toBe("theme");
    expect(values.get("profile apply")).toBe("profile");
    expect(values.get("profile show")).toBe("profile");
    expect(values.get("profile export")).toBe("profile");
    expect(values.get("restore")).toBe("backup");
    expect(values.get("theme validate")).toBe("");
    expect(values.get("profile import")).toBe("");
    expect(values.get("font check")).toBe("");
    // `font install <path>` takes a filesystem path, not an id from a registry, so it gets no
    // completion values - the same answer `theme validate <file>` gets, for the same reason.
    expect(values.get("font install")).toBe("");
    expect(values.get("theme list")).toBe("");
    // Every command in the tree is in the table, including the root.
    expect(values.has("")).toBe(true);
  });

  it("escapes single quotes in generated PowerShell string literals", () => {
    // Nothing in the real tree contains a quote today; the escape exists so that a future
    // command name cannot break out of the literal and corrupt the script.
    const program = new Command().name("nightshift");
    program.command("it's-a-trap").description("probe");

    const script = powershellCompletionScript(program);
    expect(script).toContain("'it''s-a-trap'");
    expect(collectCompletionNodes(program).map((node) => node.path)).toEqual(["", "it's-a-trap"]);
  });

  it("keeps its static import graph off the expensive packages", () => {
    const packages = staticPackageImports(path.join(repoRoot, "dist/cli/commands/completion.js"));

    // The two measured heavyweights (zod 228 ms, boxen 125 ms) plus the interactive stack and
    // the table renderer. `completion` is print-and-exit; it must stay the cheapest command.
    for (const forbidden of ["zod", "boxen", "@clack/prompts", "cli-table3"]) {
      expect([...packages]).not.toContain(forbidden);
    }
    // commander is type-only and therefore erased, so chalk (via ui/feedback) is all that is
    // left. Asserted exactly, so a new dependency on this path has to be deliberate.
    expect([...packages].sort()).toEqual(["chalk"]);
  });

  describe("dynamic values", () => {
    let tmpRoot: string;
    let originalAppData: string | undefined;
    let originalXdg: string | undefined;

    beforeEach(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-completion-"));
      originalAppData = process.env.APPDATA;
      originalXdg = process.env.XDG_CONFIG_HOME;
      process.env.APPDATA = tmpRoot;
      process.env.XDG_CONFIG_HOME = tmpRoot;
    });

    afterEach(() => {
      process.env.APPDATA = originalAppData;
      process.env.XDG_CONFIG_HOME = originalXdg;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("returns exactly the ids the corresponding list command shows", async () => {
      const source = path.join(tmpRoot, "settings.json");
      fs.writeFileSync(source, "{}");
      const backup = createBackup(source, "completion test");

      expect(await completionValues("theme")).toEqual(listThemes().map((e) => e.theme.id));
      expect(await completionValues("profile")).toEqual(listProfiles().map((e) => e.profile.id));
      expect(await completionValues("backup")).toEqual(listBackups().map((b) => b.id));
      // The id a human cannot reasonably type, which is the reason #30 exists.
      expect(await completionValues("backup")).toContain(backup.id);
    });

    it("picks up a user theme added after install, which a hardcoded list could not", async () => {
      const themesDir = path.join(tmpRoot, "nightshift", "themes");
      fs.mkdirSync(themesDir, { recursive: true });
      const builtin = listThemes()[0]?.theme;
      fs.writeFileSync(
        path.join(themesDir, "added-later.json"),
        JSON.stringify({ ...builtin, id: "added-later", name: "Added Later" }),
      );

      expect(await completionValues("theme")).toContain("added-later");
    });

    it("returns null for an unknown kind instead of an empty list", async () => {
      // An empty list would be rendered by the shell as "no themes exist", which is a different
      // claim from "that is not a kind of thing NIGHTSHIFT completes".
      expect(await completionValues("fonts")).toBeNull();
    });
  });
});
