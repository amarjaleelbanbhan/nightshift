import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { renderBanner } from "../../banners/startup.js";
import { readConfig, isInitialized } from "../../core/config/store.js";
import { getTheme, listThemes } from "../../core/themes/registry.js";
import { runThemeList, runThemePreview, runThemeApply } from "../commands/theme.js";
import { runProfileList } from "../commands/profile.js";
import { runDoctor } from "../commands/doctor.js";
import { runBackupCreate, runBackupList } from "../commands/backup.js";

const PLANNED = chalk.gray("(planned — not yet implemented)");

type MenuChoice =
  | "theme"
  | "profile"
  | "widgets"
  | "ascii"
  | "terminal"
  | "claude"
  | "marketplace"
  | "doctor"
  | "backup"
  | "exit";

export async function runInteractiveHome(): Promise<void> {
  const config = isInitialized() ? readConfig() : null;
  const activeTheme = config?.activeThemeId ? getTheme(config.activeThemeId) : undefined;
  console.log(renderBanner(activeTheme));

  for (;;) {
    const choice = await select<MenuChoice>({
      message: "NIGHTSHIFT",
      choices: [
        { name: "Theme Manager", value: "theme" },
        { name: `Profile Manager ${PLANNED.replace("not yet implemented", "list only for now")}`, value: "profile" },
        { name: `Widget Center ${PLANNED}`, value: "widgets" },
        { name: `ASCII Art Studio ${PLANNED}`, value: "ascii" },
        { name: `Terminal Settings ${PLANNED.replace("not yet implemented", "use Theme Manager to apply")}`, value: "terminal" },
        { name: `Claude Code Integration ${PLANNED}`, value: "claude" },
        { name: `Marketplace ${PLANNED}`, value: "marketplace" },
        { name: "Environment Doctor", value: "doctor" },
        { name: "Backup and Restore", value: "backup" },
        { name: "Exit", value: "exit" },
      ],
    });

    if (choice === "exit") return;
    if (choice === "widgets" || choice === "ascii" || choice === "terminal" || choice === "claude" || choice === "marketplace") {
      console.log(chalk.yellow("This section is planned but not implemented yet."));
      continue;
    }
    if (choice === "profile") {
      runProfileList();
      continue;
    }
    if (choice === "doctor") {
      runDoctor();
      continue;
    }
    if (choice === "backup") {
      await runBackupMenu();
      continue;
    }
    if (choice === "theme") {
      await runThemeMenu();
      continue;
    }
  }
}

async function runThemeMenu(): Promise<void> {
  const action = await select({
    message: "Theme Manager",
    choices: [
      { name: "List themes", value: "list" },
      { name: "Preview a theme", value: "preview" },
      { name: "Apply a theme", value: "apply" },
      { name: "Back", value: "back" },
    ],
  });
  if (action === "back") return;
  if (action === "list") {
    runThemeList();
    return;
  }
  const themeId = await select({
    message: action === "preview" ? "Preview which theme?" : "Apply which theme?",
    choices: listThemes().map(({ theme }) => ({ name: theme.name, value: theme.id })),
  });
  if (action === "preview") runThemePreview(themeId);
  if (action === "apply") runThemeApply(themeId);
}

async function runBackupMenu(): Promise<void> {
  const action = await select({
    message: "Backup and Restore",
    choices: [
      { name: "Create backup of Windows Terminal settings", value: "create" },
      { name: "List backups", value: "list" },
      { name: "Back", value: "back" },
    ],
  });
  if (action === "create") runBackupCreate();
  if (action === "list") runBackupList();
}
