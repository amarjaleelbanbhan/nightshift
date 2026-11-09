import chalk from "chalk";
import process from "node:process";
import { detectCapabilities } from "../../core/capabilities/detect.js";
import { isInitialized } from "../../core/config/store.js";

interface Check {
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export function runDoctor(): void {
  const caps = detectCapabilities();
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
    detail: caps.claudeCode.settingsPath ?? "~/.claude/settings.json not found (integration is optional)",
  });

  checks.push({
    label: "NIGHTSHIFT config",
    status: isInitialized() ? "ok" : "warn",
    detail: isInitialized() ? "initialized" : "not initialized, run `nightshift init`",
  });

  console.log(chalk.bold("NIGHTSHIFT Environment Doctor"));
  console.log();
  for (const check of checks) {
    const icon =
      check.status === "ok" ? chalk.green("✓") : check.status === "warn" ? chalk.yellow("!") : chalk.red("✗");
    console.log(`${icon} ${check.label.padEnd(20)} ${chalk.gray(check.detail)}`);
  }

  if (checks.some((c) => c.status === "fail")) {
    process.exitCode = 1;
  }
}
