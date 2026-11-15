import chalk from "chalk";
import process from "node:process";
import { detectCapabilities } from "../../core/capabilities/detect.js";
import { isInitialized, tryReadConfig, type ConfigReadResult } from "../../core/config/store.js";
import { inspectUserProfilesDirectory } from "../../core/profiles/registry.js";
import { renderTable } from "../ui/table.js";
import { getTheme } from "../../core/themes/registry.js";
import type { Theme } from "../../core/themes/schema.js";
import { auditThemeContrast, WCAG_AA_BODY, WCAG_AA_LARGE } from "../../core/themes/contrast.js";
import { findInstalledFont } from "../../core/fonts/detect.js";
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

export function runDoctor(): void {
  const caps = detectCapabilities();
  const configResult = tryReadConfig();
  const checks: Check[] = [];

  const [major] = process.versions.node.split(".").map(Number);
  checks.push({
    label: "Node.js version",
    status: major !== undefined && major >= 18 ? "ok" : "fail",
    detail: `v${process.versions.node} (requires >=18)`,
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
    status:
      caps.windowsTerminal.support === "supported"
        ? "ok"
        : caps.platform === "win32"
          ? "warn"
          : "warn",
    detail: caps.windowsTerminal.settingsPath ?? "settings.json not found",
  });

  checks.push({
    label: "Claude Code",
    status: caps.claudeCode.settingsPath ? "ok" : "warn",
    detail:
      caps.claudeCode.settingsPath ?? "~/.claude/settings.json not found (integration is optional)",
  });

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
