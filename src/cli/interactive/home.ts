import chalk from "chalk";
import { renderMasthead } from "../../banners/startup.js";
import { intro, outro, log, promptSelect, promptText } from "../ui/prompts.js";
import { listThemes } from "../../core/themes/registry.js";
import { listProfiles, getProfile } from "../../core/profiles/registry.js";
import {
  getNightshiftRoot,
  getUserThemesDir,
  getUserProfilesDir,
  getBackupsDir,
} from "../../core/config/paths.js";
import {
  runThemeList,
  runThemePreview,
  runThemeApply,
  runThemeValidate,
  runThemeCreate,
  runThemeRemove,
} from "../commands/theme.js";
import { runSetup } from "../commands/setup.js";
import {
  runProfileApply,
  runProfileImport,
  runProfileExport,
  runProfileRemove,
} from "../commands/profile.js";
import { runProfileList } from "../commands/profile.js";
import { runDoctor } from "../commands/doctor.js";
import { runFontList, runFontCheck } from "../commands/font.js";
import { runBackupCreate, runBackupList } from "../commands/backup.js";
import { runStatus } from "../commands/status.js";

const PLANNED = "This section is planned but not implemented yet.";

type Section = "workspace" | "customization" | "integrations" | "system" | "exit";

export async function runInteractiveHome(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    // An interactive select() prompt has nothing to read from in CI/pipes/redirected output
    // and will hang waiting for input that will never arrive. Print the same status a
    // real session would open with, then exit cleanly instead of hanging.
    runStatus();
    console.log();
    console.log(
      chalk.gray("Non-interactive environment detected - run a specific command instead, e.g.:"),
    );
    console.log(chalk.gray("  nightshift theme list"));
    console.log(chalk.gray("  nightshift profile list"));
    console.log(chalk.gray("  nightshift doctor"));
    return;
  }

  intro(chalk.bold(renderMasthead()));
  runStatus();

  for (;;) {
    const section = await promptSelect<Section>("NIGHTSHIFT", [
      { label: "Workspace", value: "workspace", hint: "dashboard, doctor, quick actions" },
      {
        label: "Customization",
        value: "customization",
        hint: "themes, profiles, ASCII art, widgets",
      },
      { label: "Integrations", value: "integrations", hint: "terminal, shell, Claude Code" },
      { label: "System", value: "system", hint: "setup, fonts, backups, settings" },
      { label: "Exit", value: "exit" },
    ]);

    if (!section || section === "exit") break;
    if (section === "workspace") await runWorkspaceMenu();
    if (section === "customization") await runCustomizationMenu();
    if (section === "integrations") await runIntegrationsMenu();
    if (section === "system") await runSystemMenu();

    // The commands above set process.exitCode on failure, and that value would otherwise stick
    // for the rest of the session: one failed action in the middle of a long menu session made
    // the whole session exit non-zero even after everything else succeeded (A-9). The user saw
    // the failure reported inline and chose to carry on, so the session's exit code should
    // describe the session, not its worst moment. One-shot commands are unaffected - this reset
    // happens only inside the interactive loop, where the failure has already been shown.
    process.exitCode = 0;
  }

  outro("See you next session.");
}

async function runWorkspaceMenu(): Promise<void> {
  const choice = await promptSelect("Workspace", [
    { label: "Dashboard", value: "dashboard", hint: "re-show current status" },
    { label: "Environment Doctor", value: "doctor" },
    { label: "Quick action: apply a theme", value: "quick-apply" },
    { label: "Back", value: "back" },
  ]);
  if (!choice || choice === "back") return;
  if (choice === "dashboard") runStatus();
  if (choice === "doctor") runDoctor();
  if (choice === "quick-apply") await applyThemeInteractive();
}

async function runCustomizationMenu(): Promise<void> {
  const choice = await promptSelect("Customization", [
    { label: "Theme Studio", value: "theme" },
    { label: "Profile Manager", value: "profile" },
    { label: "ASCII Art Studio", value: "ascii", hint: "planned" },
    { label: "Widgets", value: "widgets", hint: "planned" },
    { label: "Back", value: "back" },
  ]);
  if (!choice || choice === "back") return;
  if (choice === "theme") await runThemeMenu();
  if (choice === "profile") await runProfileMenu();
  if (choice === "ascii" || choice === "widgets") log.warn(PLANNED);
}

async function runIntegrationsMenu(): Promise<void> {
  const choice = await promptSelect("Integrations", [
    {
      label: "Terminal Manager",
      value: "terminal",
      hint: "planned — use Theme Studio to apply colors today",
    },
    { label: "Shell Manager", value: "shell", hint: "planned" },
    { label: "Claude Code", value: "claude", hint: "planned" },
    { label: "Back", value: "back" },
  ]);
  if (!choice || choice === "back") return;
  log.warn(PLANNED);
}

async function runSystemMenu(): Promise<void> {
  const choice = await promptSelect("System", [
    { label: "Setup", value: "setup", hint: "first-run configuration" },
    { label: "Fonts", value: "fonts", hint: "detect installed fonts (installing: not yet)" },
    { label: "Backups", value: "backups" },
    { label: "Settings", value: "settings" },
    { label: "Back", value: "back" },
  ]);
  if (!choice || choice === "back") return;
  if (choice === "setup") await runSetup();
  if (choice === "backups") await runBackupMenu();
  if (choice === "settings") runSettings();
  if (choice === "fonts") await runFontsMenu();
}

/**
 * Detection is real; installation is not. Installing a font writes outside NIGHTSHIFT's own
 * config directory, so it needs the same shown-proposal-and-approval flow `setup` has - it is
 * tracked separately and stays labelled here rather than being hidden, so the menu never implies
 * a capability that does not exist.
 */
async function runFontsMenu(): Promise<void> {
  const action = await promptSelect("Fonts", [
    { label: "List installed fonts", value: "list" },
    { label: "Check a specific family", value: "check", hint: "e.g. the font your theme asks for" },
    { label: "Install a font", value: "install", hint: "not implemented" },
    { label: "Back", value: "back" },
  ]);
  if (!action || action === "back") return;

  if (action === "list") {
    runFontList();
    return;
  }
  if (action === "check") {
    const family = await promptText("Font family to check (e.g. Cascadia Code):");
    if (!family) return;
    runFontCheck(family);
    return;
  }
  log.warn(
    "Font installation is not implemented. It writes outside NIGHTSHIFT's config directory, so " +
      "it needs an explicit proposal-and-approval flow first. Install fonts with Windows' own " +
      "font installer for now, then run `nightshift font check <family>` to confirm.",
  );
}

function runSettings(): void {
  log.info(
    [
      `Config directory:  ${getNightshiftRoot()}`,
      `User themes:       ${getUserThemesDir()}`,
      `User profiles:     ${getUserProfilesDir()}`,
      `Backups:           ${getBackupsDir()}`,
    ].join("\n"),
  );
}

async function applyThemeInteractive(): Promise<void> {
  const themeId = await promptSelect(
    "Apply which theme?",
    listThemes().map(({ theme }) => ({ label: theme.name, value: theme.id })),
  );
  if (!themeId) return;
  runThemeApply(themeId);
}

async function runThemeMenu(): Promise<void> {
  const action = await promptSelect("Theme Studio", [
    { label: "List themes", value: "list" },
    { label: "Preview a theme", value: "preview" },
    { label: "Apply a theme", value: "apply" },
    { label: "Validate a theme file", value: "validate" },
    { label: "Create a new theme", value: "create" },
    { label: "Remove a user theme", value: "remove" },
    { label: "Back", value: "back" },
  ]);
  if (!action || action === "back") return;
  if (action === "list") {
    runThemeList();
    return;
  }

  if (action === "validate") {
    const file = await promptText("Path to the theme JSON file to validate:");
    if (!file) return;
    runThemeValidate(file);
    return;
  }

  if (action === "create") {
    const id = await promptText("Id for the new theme (lowercase, digits, hyphens):");
    if (!id) return;
    const name = await promptText("Display name:");
    if (!name) return;
    const from = await promptSelect(
      "Clone which theme as the starting point?",
      listThemes().map(({ theme }) => ({ label: theme.name, value: theme.id })),
    );
    if (!from) return;
    runThemeCreate({ id, name, from });
    return;
  }

  if (action === "remove") {
    const userThemes = listThemes().filter((e) => e.source === "user");
    if (userThemes.length === 0) {
      log.info("No user themes to remove. Built-in themes cannot be removed.");
      return;
    }
    const removeId = await promptSelect(
      "Remove which theme?",
      userThemes.map(({ theme }) => ({ label: theme.name, value: theme.id })),
    );
    if (!removeId) return;
    runThemeRemove(removeId);
    return;
  }

  const themeId = await promptSelect(
    action === "preview" ? "Preview which theme?" : "Apply which theme?",
    listThemes().map(({ theme }) => ({ label: theme.name, value: theme.id })),
  );
  if (!themeId) return;
  if (action === "preview") runThemePreview(themeId);
  if (action === "apply") runThemeApply(themeId);
}

async function runProfileMenu(): Promise<void> {
  const action = await promptSelect("Profile Manager", [
    { label: "List profiles", value: "list" },
    { label: "Apply a profile", value: "apply" },
    { label: "Import a profile", value: "import" },
    { label: "Export a profile", value: "export" },
    { label: "Remove a user profile", value: "remove" },
    { label: "Back", value: "back" },
  ]);

  if (!action || action === "back") return;
  if (action === "list") {
    runProfileList();
    return;
  }

  if (action === "import") {
    const file = await promptText("Path to the profile JSON file to import:");
    if (!file) return;
    runProfileImport(file, {});
    return;
  }

  const entries =
    action === "remove" ? listProfiles().filter((e) => e.source === "user") : listProfiles();
  if (entries.length === 0) {
    log.info(action === "remove" ? "No user profiles to remove." : "No profiles found.");
    return;
  }
  const profileId = await promptSelect(
    `${action === "apply" ? "Apply" : action === "export" ? "Export" : "Remove"} which profile?`,
    entries.map(({ profile }) => ({ label: profile.name, value: profile.id })),
  );
  if (!profileId) return;

  if (action === "apply") {
    const entry = getProfile(profileId);
    const confirmed = await promptSelect(
      `Apply "${entry?.profile.name}" (theme: ${entry?.profile.themeId})?`,
      [
        { label: "Yes, apply", value: "yes" },
        { label: "No, cancel", value: "no" },
      ],
    );
    if (confirmed === "yes") runProfileApply(profileId);
    return;
  }

  if (action === "export") {
    const output = await promptText("Destination path (leave blank for default):");
    if (output === null) return;
    runProfileExport(profileId, { output: output || undefined });
    return;
  }

  runProfileRemove(profileId);
}

async function runBackupMenu(): Promise<void> {
  const action = await promptSelect("Backups", [
    { label: "Create backup of Windows Terminal settings", value: "create" },
    { label: "List backups", value: "list" },
    { label: "Back", value: "back" },
  ]);
  if (action === "create") runBackupCreate();
  if (action === "list") runBackupList();
}
