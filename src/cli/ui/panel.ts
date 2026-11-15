import "./color-mode.js";
import boxen from "boxen";
import chalk from "chalk";

export interface PanelOptions {
  title?: string;
  borderColorHex?: string;
}

/**
 * A bordered panel for one-shot command output (status/doctor headers), independent of the
 * interactive menu's clack-driven box style (clack's own `note`/`box` are used there instead,
 * so the border language matches whichever context it's rendered in).
 *
 * `borderColor` is dropped when color is off. boxen resolves its border styling against chalk's
 * level *at its own import time*, so lowering `chalk.level` afterwards does not reach it - this
 * leaked 4 colored border lines from `status` under `NO_COLOR=1`. Checking `chalk.level` here
 * instead is independent of module evaluation order, and also covers plain non-TTY output.
 */
export function panel(content: string, options: PanelOptions = {}): string {
  const colorEnabled = chalk.level > 0;
  return boxen(content, {
    padding: { left: 2, right: 2, top: 0, bottom: 0 },
    borderStyle: "round",
    ...(colorEnabled ? { borderColor: options.borderColorHex ?? "gray" } : {}),
    ...(options.title ? { title: options.title, titleAlignment: "left" as const } : {}),
  });
}
