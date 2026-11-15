import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { locateWindowsTerminalSettings } from "../../adapters/windows-terminal/locate.js";

export type SupportLevel = "supported" | "partial" | "unsupported" | "unknown";

export interface Capabilities {
  platform: NodeJS.Platform;
  platformSupport: SupportLevel;
  windowsTerminal: {
    support: SupportLevel;
    settingsPath: string | null;
  };
  claudeCode: {
    support: SupportLevel;
    settingsPath: string | null;
  };
}

function locateClaudeCodeSettings(): string | null {
  // path.join, not string concatenation: concatenating produced the mixed-separator path
  // `C:\Users\Amar/.claude/settings.json` in `doctor` and `status` output (F7).
  const candidate = path.join(os.homedir(), ".claude", "settings.json");
  return fs.existsSync(candidate) ? candidate : null;
}

export function detectCapabilities(): Capabilities {
  const platform = os.platform();
  const platformSupport: SupportLevel = platform === "win32" ? "supported" : "unsupported";

  const settingsPath = platform === "win32" ? locateWindowsTerminalSettings() : null;
  const claudeSettingsPath = locateClaudeCodeSettings();

  return {
    platform,
    platformSupport,
    windowsTerminal: {
      support: settingsPath ? "supported" : platform === "win32" ? "unknown" : "unsupported",
      settingsPath,
    },
    claudeCode: {
      support: claudeSettingsPath ? "partial" : "unknown",
      settingsPath: claudeSettingsPath,
    },
  };
}
