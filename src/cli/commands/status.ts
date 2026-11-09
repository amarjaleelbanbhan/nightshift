import chalk from "chalk";
import os from "node:os";
import { readConfig, isInitialized } from "../../core/config/store.js";
import { detectCapabilities } from "../../core/capabilities/detect.js";
import { getTheme } from "../../core/themes/registry.js";
import { getProfile } from "../../core/profiles/registry.js";
import { renderStatusPanel } from "../../banners/startup.js";
import { renderTable } from "../ui/table.js";

export function runStatus(): void {
  const caps = detectCapabilities();
  const config = isInitialized() ? readConfig() : null;
  const activeTheme = config?.activeThemeId ? getTheme(config.activeThemeId) : undefined;
  const activeProfile = config?.activeProfileId ? getProfile(config.activeProfileId) : undefined;

  console.log(renderStatusPanel(activeTheme));
  console.log(
    renderTable(
      ["Field", "Value"],
      [
        ["OS", `${os.platform()} ${os.release()}`],
        ["Windows Terminal", describe(caps.windowsTerminal.support, caps.windowsTerminal.settingsPath)],
        ["Claude Code", describe(caps.claudeCode.support, caps.claudeCode.settingsPath)],
        [
          "Config",
          isInitialized()
            ? chalk.green("initialized")
            : chalk.yellow("not initialized (run `nightshift init`)"),
        ],
        ["Active theme", activeTheme ? activeTheme.name : chalk.gray("none")],
        ["Active profile", activeProfile ? activeProfile.profile.name : chalk.gray("none")],
      ],
    ),
  );
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
