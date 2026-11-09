import boxen from "boxen";

export interface PanelOptions {
  title?: string;
  borderColorHex?: string;
}

/**
 * A bordered panel for one-shot command output (status/doctor headers), independent of the
 * interactive menu's clack-driven box style (clack's own `note`/`box` are used there instead,
 * so the border language matches whichever context it's rendered in).
 */
export function panel(content: string, options: PanelOptions = {}): string {
  return boxen(content, {
    padding: { left: 2, right: 2, top: 0, bottom: 0 },
    borderStyle: "round",
    borderColor: options.borderColorHex ?? "gray",
    ...(options.title ? { title: options.title, titleAlignment: "left" as const } : {}),
  });
}
