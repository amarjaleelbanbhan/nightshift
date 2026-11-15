import chalk from "chalk";
import os from "node:os";
import { tryReadConfig, isInitialized } from "../../core/config/store.js";
import { detectCapabilities } from "../../core/capabilities/detect.js";
import { describeSettingsPath } from "../../adapters/windows-terminal/locate.js";
import { getTheme } from "../../core/themes/registry.js";
import { getProfile } from "../../core/profiles/registry.js";
import { renderStatusPanel } from "../../banners/startup.js";
import { renderTable } from "../ui/table.js";
import { reportConfigCorrupt } from "../errors.js";

export function runStatus(): void {
  const caps = detectCapabilities();
  // `status` is one of the commands a user runs *because* something is wrong, so a corrupt
  // config.json degrades the active-theme/profile rows rather than killing the report. The
  // corruption is named on stderr and reflected in the exit code, so it is never silent.
  const configResult = tryReadConfig();
  const config = configResult.ok ? configResult.config : null;
  const activeTheme = config?.activeThemeId ? getTheme(config.activeThemeId) : undefined;
  const activeProfile = config?.activeProfileId ? getProfile(config.activeProfileId) : undefined;

  console.log(renderStatusPanel(activeTheme));
  console.log(
    renderTable(
      ["Field", "Value"],
      [
        ["OS", `${os.platform()} ${os.release()}`],
        [
          "Windows Terminal",
          describe(
            caps.windowsTerminal.support,
            // Resolved, so the path shown is the one a theme apply would write (#27).
            caps.windowsTerminal.settingsPath &&
              describeSettingsPath(caps.windowsTerminal.settingsPath),
          ),
        ],
        ["Claude Code", describe(caps.claudeCode.support, caps.claudeCode.settingsPath)],
        [
          "Config",
          !configResult.ok
            ? chalk.red("corrupt or unreadable")
            : isInitialized()
              ? chalk.green("initialized")
              : chalk.yellow("not initialized (run `nightshift init`)"),
        ],
        ["Active theme", activeTheme ? activeTheme.name : chalk.gray("none")],
        ["Active profile", activeProfile ? activeProfile.profile.name : chalk.gray("none")],
      ],
    ),
  );

  if (!configResult.ok) {
    reportConfigCorrupt(configResult.error);
  }
}

function describe(support: string, locatedPath: string | null): string {
  const label =
    support === "supported"
      ? chalk.green("detected")
      : support === "partial"
        ? chalk.yellow("partially detected")
        : support === "unsupported"
          ? chalk.gray("unsupported on this platform")
          : chalk.gray("not detected");
  return locatedPath ? `${label} (${locatedPath})` : label;
}
