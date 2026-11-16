import chalk from "chalk";
import process from "node:process";
import { detectCapabilities } from "../../core/capabilities/detect.js";
import { describeSettingsPath } from "../../adapters/windows-terminal/locate.js";
import { isInitialized, tryReadConfig, type ConfigReadResult } from "../../core/config/store.js";
import { inspectUserProfilesDirectory } from "../../core/profiles/registry.js";
import { renderTable } from "../ui/table.js";
import { getTheme } from "../../core/themes/registry.js";
import type { Theme } from "../../core/themes/schema.js";
import { auditThemeContrast, WCAG_AA_BODY, WCAG_AA_LARGE } from "../../core/themes/contrast.js";
import { findInstalledFont } from "../../core/fonts/detect.js";
import {
  readClaudeCodeSettings,
  claudeThemeAppearance,
  backgroundAppearance,
} from "../../core/integrations/claude-code.js";
import { EXIT_FAILURE, EXIT_CONFIG_CORRUPT } from "../errors.js";

interface Check {
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

/**
 * The active theme, or the reason there is no theme to inspect. Shared by every active-theme
 * check below: this preamble (initialized? config readable? an active id? does it resolve?) used
 * to be copied per check, which meant a fix to one copy left the others reporting differently
 * about the same state.
 */
function activeThemeOrReason(configResult: ConfigReadResult): Theme | { reason: string } {
  if (!isInitialized()) return { reason: "no active theme to check (run `nightshift init`)" };
  // The config check further down reports the corruption in full; don't repeat it here.
  if (!configResult.ok) return { reason: "skipped - config.json could not be read" };
  const activeThemeId = configResult.config.activeThemeId;
  if (!activeThemeId) {
    return { reason: "no active theme to check (run `nightshift theme apply <id>`)" };
  }
  const theme = getTheme(activeThemeId);
  if (!theme) return { reason: `active theme "${activeThemeId}" was not found` };
  return theme;
}

/**
 * WCAG AA contrast of the *active* theme's colors against its own background. Reported as a
 * warning rather than a failure: a low-contrast theme is a readability problem with the user's
 * chosen palette, not a broken environment, so it must not change `doctor`'s exit code.
 */
function activeThemeContrastCheck(configResult: ConfigReadResult): Check {
  const label = "Theme contrast";
  const theme = activeThemeOrReason(configResult);
  if ("reason" in theme) return { label, status: "warn", detail: theme.reason };

  const results = auditThemeContrast(theme);
  const failing = results.filter((r) => !r.passesBody);
  const summary = `${theme.id}: ${results.map((r) => `${r.role} ${r.ratio.toFixed(2)}:1`).join(", ")}`;
  if (failing.length === 0) {
    return {
      label,
      status: "ok",
      detail: `all ${results.length} pairs meet WCAG AA ${WCAG_AA_BODY}:1 - ${summary}`,
    };
  }
  return {
    label,
    status: "warn",
    detail:
      `${failing.length} below WCAG AA ${WCAG_AA_BODY}:1 for body text ` +
      `(${failing.map((r) => `${r.role} ${r.ratio.toFixed(2)}:1`).join(", ")}; ` +
      `>=${WCAG_AA_LARGE}:1 is AA for large text) - ${summary}`,
  };
}

/**
 * Whether Claude Code's own light/dark setting agrees with the active theme's background (#18).
 *
 * This is the whole of the Claude Code integration, by decision: NIGHTSHIFT reads one key and
 * never writes the file. The check exists because the failure is real and its cause is
 * non-obvious - you change your *terminal* theme and a *different tool* starts rendering
 * light-theme syntax colors on a dark background. Nothing else told the user why.
 *
 * `warn` throughout, never `fail`. Claude Code is an optional integration, the setting belongs
 * to another tool, and `doctor` has to stay usable as a scripted health gate.
 */
function claudeCodeAppearanceCheck(
  settingsPath: string | null,
  configResult: ConfigReadResult,
): Check {
  const label = "Claude Code appearance";
  const settings = readClaudeCodeSettings(settingsPath);

  if (settings.state === "absent") {
    return { label, status: "ok", detail: "no Claude Code settings to compare (optional)" };
  }
  if (settings.state === "unreadable") {
    // Named rather than swallowed: a settings file Claude Code itself cannot read is worth
    // knowing about, and this is the command people run when something is already wrong.
    return {
      label,
      status: "warn",
      detail: `~/.claude/settings.json could not be read - ${settings.detail}`,
    };
  }

  const claude = claudeThemeAppearance(settings.theme);
  if (claude === null) {
    return {
      label,
      status: "ok",
      detail: settings.theme
        ? `Claude Code theme "${settings.theme}" is neither light nor dark - nothing to compare`
        : "Claude Code sets no theme, so it follows its own default",
    };
  }

  const theme = activeThemeOrReason(configResult);
  if ("reason" in theme) return { label, status: "warn", detail: theme.reason };
  const terminal = backgroundAppearance(theme.colors.background);

  if (terminal === claude) {
    return {
      label,
      status: "ok",
      detail: `both ${claude} - Claude Code theme "${settings.theme}", ${theme.id} background ${theme.colors.background}`,
    };
  }
  return {
    label,
    status: "warn",
    detail:
      `Claude Code is set to "${settings.theme}" (${claude}) but ${theme.id}'s background ` +
      `${theme.colors.background} is ${terminal}, so Claude Code will render its ${claude} ` +
      `syntax colors on a ${terminal} terminal. Change the theme in Claude Code to match.`,
  };
}

/**
 * Whether the *active* theme's `typography.family` is actually installed.
 *
 * This is the check that exists because of a real silent failure: `theme apply` writes
 * `typography.family` into Windows Terminal's `profiles.defaults.font.face`, Windows Terminal
 * silently substitutes a default when that family is not installed, and NIGHTSHIFT printed
 * `✓ Applied` either way. The user got a terminal that did not match the preview with no
 * explanation anywhere. Naming it here is the whole point.
 *
 * `warn`, not `fail`: a missing font is a fixable state in the user's environment, in the same
 * class as a low-contrast palette, and `doctor` must stay usable as a scripted health gate (see
 * docs/ARCHITECTURE.md). `typography` is optional in `themeSchema`, so its absence is "no font
 * requested" - an `ok`, not a problem.
 */
function activeThemeFontCheck(configResult: ConfigReadResult): Check {
  const label = "Theme font";
  const theme = activeThemeOrReason(configResult);
  if ("reason" in theme) return { label, status: "warn", detail: theme.reason };

  const family = theme.typography?.family;
  if (!family) {
    return { label, status: "ok", detail: `${theme.id} requests no specific font family` };
  }

  const lookup = findInstalledFont(family);
  if (lookup.support !== "supported") {
    return {
      label,
      status: "warn",
      detail: `cannot verify "${family}" - font detection reports ${lookup.support} on ${lookup.platform}`,
    };
  }
  if (!lookup.match) {
    return {
      label,
      status: "warn",
      detail:
        `${theme.id} requests "${family}", which is not installed - Windows Terminal will ` +
        "silently substitute another font, so the terminal will not match the theme preview " +
        "(run `nightshift font list` to see what is installed)",
    };
  }
  return {
    label,
    status: "ok",
    detail: `${theme.id} requests "${family}" - installed ${
      lookup.match.source === "user" ? "for this user" : "for all users"
    }`,
  };
}

/**
 * The single source of truth for the runtime floor *inside the code*. It must stay equal to
 * `engines.node` in package.json and the low rail of the CI matrix. 22.12.0 rather than 22.0.0
 * because vitest 5 cannot run below it, so 22.0.0-22.11.x could never be exercised by this
 * project's own suite - declaring a floor that cannot be tested is the same false promise as
 * declaring one that is too low.
 */
export const MIN_NODE_VERSION = "22.12.0";

/**
 * Compares a Node version string against MIN_NODE_VERSION.
 *
 * Takes the version as an argument instead of reading `process.versions.node` itself, which is
 * why this exists as a separate function: the previous check compared `major >= 18` inline, so
 * no test could exercise any runtime other than the one running the suite. That is exactly how
 * it kept reporting `ok` on Node 18 and 20 after the floor moved to 22.12.0 - `doctor` told the
 * user their environment was fine while `npm install` was refusing it with EBADENGINE.
 *
 * Unparseable input returns false: failing closed on a version we cannot read is safer than
 * claiming support for it.
 */
export function meetsNodeFloor(version: string): boolean {
  const required = MIN_NODE_VERSION.split(".").map(Number);
  const actual = version.split(".").map((part) => Number.parseInt(part, 10));
  if (actual.length < 3 || actual.some((n) => !Number.isFinite(n))) return false;

  for (let i = 0; i < 3; i += 1) {
    const a = actual[i] ?? 0;
    const r = required[i] ?? 0;
    if (a !== r) return a > r;
  }
  return true;
}

export function runDoctor(): void {
  const caps = detectCapabilities();
  const configResult = tryReadConfig();
  const checks: Check[] = [];

  checks.push({
    label: "Node.js version",
    status: meetsNodeFloor(process.versions.node) ? "ok" : "fail",
    detail: `v${process.versions.node} (requires >=${MIN_NODE_VERSION})`,
  });

  checks.push({
    label: "Platform support",
    status: caps.platformSupport === "supported" ? "ok" : "warn",
    detail:
      caps.platformSupport === "supported"
        ? `${caps.platform} is fully supported`
        : `${caps.platform} adapters are not implemented yet (Windows 11 is the initial target)`,
  });

  checks.push({
    label: "Windows Terminal",
    // Both arms of the old `caps.platform === "win32" ? "warn" : "warn"` ternary were identical,
    // so the platform test was dead. The distinction it was reaching for is already carried by
    // the Platform support check above and by the detail line below.
    status: caps.windowsTerminal.support === "supported" ? "ok" : "warn",
    // Resolved, so the path reported is the one a theme apply would write (#27). `doctor` is
    // run *because* something is wrong, so a dangling link is labelled rather than thrown.
    detail: caps.windowsTerminal.settingsPath
      ? describeSettingsPath(caps.windowsTerminal.settingsPath)
      : "settings.json not found",
  });

  checks.push({
    label: "Claude Code",
    status: caps.claudeCode.settingsPath ? "ok" : "warn",
    detail:
      caps.claudeCode.settingsPath ?? "~/.claude/settings.json not found (integration is optional)",
  });
  checks.push(claudeCodeAppearanceCheck(caps.claudeCode.settingsPath, configResult));

  // Before this, the check was `isInitialized() ? "ok" : "warn"` - and `isInitialized()` is
  // only `fs.existsSync`, so a corrupt config.json exists and was reported as `✓ initialized`.
  // The one command a user runs when things are broken was hiding the breakage (A-4).
  const configCheck: Check = !isInitialized()
    ? {
        label: "NIGHTSHIFT config",
        status: "warn",
        detail: "not initialized, run `nightshift init`",
      }
    : configResult.ok
      ? { label: "NIGHTSHIFT config", status: "ok", detail: "initialized" }
      : { label: "NIGHTSHIFT config", status: "fail", detail: configResult.error.message };
  checks.push(configCheck);

  const userProfiles = inspectUserProfilesDirectory();
  checks.push({
    label: "User profiles",
    status: userProfiles.invalid.length > 0 ? "warn" : "ok",
    detail: userProfiles.exists
      ? `${userProfiles.path} - ${userProfiles.validCount} valid${
          userProfiles.invalid.length > 0
            ? `, ${userProfiles.invalid.length} invalid (${userProfiles.invalid.map((i) => `${i.file}: ${i.reason}`).join("; ")})`
            : ""
        }`
      : `${userProfiles.path} (not created yet)`,
  });

  checks.push(activeThemeContrastCheck(configResult));
  checks.push(activeThemeFontCheck(configResult));

  console.log(chalk.bold("NIGHTSHIFT Environment Doctor"));
  console.log(
    renderTable(
      ["", "Check", "Detail"],
      checks.map((check) => [
        check.status === "ok"
          ? chalk.green("✓")
          : check.status === "warn"
            ? chalk.yellow("!")
            : chalk.red("✗"),
        check.label,
        chalk.gray(check.detail),
      ]),
    ),
  );

  // `doctor` exits non-zero only for `fail`, never for `warn`. That line matters: most of what
  // doctor reports is advisory (no Claude Code, a non-Windows platform, a low-contrast theme),
  // and exiting non-zero for advisories would make `doctor` useless as a CI/scripted health
  // gate. A corrupt config.json is not advisory - it breaks every other command - so it is a
  // `fail`, and it reports the same code 2 that `status` and `theme list` report for the same
  // condition. A harder environment failure (an unsupported Node version) still wins, because
  // nothing else can be trusted under it.
  const otherFailure = checks.some((c) => c.status === "fail" && c !== configCheck);
  if (otherFailure) {
    process.exitCode = EXIT_FAILURE;
  } else if (configCheck.status === "fail") {
    process.exitCode = EXIT_CONFIG_CORRUPT;
  }
}
