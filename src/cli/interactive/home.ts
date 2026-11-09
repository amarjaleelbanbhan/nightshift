import { select, input } from "@inquirer/prompts";
import chalk from "chalk";
import { renderBanner } from "../../banners/startup.js";
import { readConfig, isInitialized } from "../../core/config/store.js";
import { getTheme, listThemes } from "../../core/themes/registry.js";
import { listProfiles, getProfile } from "../../core/profiles/registry.js";
import { runThemeList, runThemePreview, runThemeApply } from "../commands/theme.js";
import {
  runProfileList,
  runProfileApply,
  runProfileImport,
  runProfileExport,
  runProfileRemove,
} from "../commands/profile.js";
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
        { name: "Profile Manager", value: "profile" },
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
      await runProfileMenu();
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

async function runProfileMenu(): Promise<void> {
  const action = await select({
    message: "Profile Manager",
    choices: [
      { name: "List profiles", value: "list" },
      { name: "Apply a profile", value: "apply" },
      { name: "Import a profile", value: "import" },
      { name: "Export a profile", value: "export" },
      { name: "Remove a user profile", value: "remove" },
      { name: "Back", value: "back" },
    ],
  });

  if (action === "back") return;
  if (action === "list") {
    runProfileList();
    return;
  }

  if (action === "import") {
    const file = await input({ message: "Path to the profile JSON file to import:" });
    runProfileImport(file, {});
    return;
  }

  if (action === "apply" || action === "export" || action === "remove") {
    const entries = action === "remove" ? listProfiles().filter((e) => e.source === "user") : listProfiles();
    if (entries.length === 0) {
      console.log(chalk.gray(action === "remove" ? "No user profiles to remove." : "No profiles found."));
      return;
    }
    const profileId = await select({
      message: `${action === "apply" ? "Apply" : action === "export" ? "Export" : "Remove"} which profile?`,
      choices: entries.map(({ profile }) => ({ name: profile.name, value: profile.id })),
    });

    if (action === "apply") {
      const entry = getProfile(profileId);
      const theme = entry ? getTheme(entry.profile.themeId) : undefined;
      console.log(chalk.gray(`This will apply theme "${entry?.profile.themeId}"${theme ? ` (${theme.name})` : " (not found!)"}.`));
      const confirmed = await select({
        message: "Apply now?",
        choices: [
          { name: "Yes, apply", value: "yes" },
          { name: "No, cancel", value: "no" },
        ],
      });
      if (confirmed === "yes") runProfileApply(profileId);
      return;
    }

    if (action === "export") {
      const output = await input({ message: "Destination path (leave blank for default):" });
      runProfileExport(profileId, { output: output || undefined });
      return;
    }

    runProfileRemove(profileId);
  }
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
