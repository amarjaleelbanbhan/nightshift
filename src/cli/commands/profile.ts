import chalk from "chalk";
import { listProfiles } from "../../core/profiles/registry.js";

export function runProfileList(): void {
  const profiles = listProfiles();
  if (profiles.length === 0) {
    console.log(chalk.gray("No profiles found."));
    return;
  }
  console.log(chalk.bold("Available profiles:"));
  for (const profile of profiles) {
    console.log(`  ${chalk.cyan(profile.id.padEnd(24))} ${profile.name}`);
    console.log(`  ${" ".repeat(24)} ${chalk.gray(`theme: ${profile.themeId}`)}`);
  }
  console.log();
  console.log(chalk.gray("Profile apply/import/export is planned for a future release."));
}
