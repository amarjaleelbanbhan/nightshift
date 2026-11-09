import { z } from "zod";

const hexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "must be a 6-digit hex color, e.g. #1A2B3C");

/** The 16 ANSI terminal colors, in standard order (black..white, then bright variants). */
export const ansiPaletteSchema = z.object({
  black: hexColor,
  red: hexColor,
  green: hexColor,
  yellow: hexColor,
  blue: hexColor,
  purple: hexColor,
  cyan: hexColor,
  white: hexColor,
  brightBlack: hexColor,
  brightRed: hexColor,
  brightGreen: hexColor,
  brightYellow: hexColor,
  brightBlue: hexColor,
  brightPurple: hexColor,
  brightCyan: hexColor,
  brightWhite: hexColor,
});

export const themeSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/, "id must be lowercase alphanumeric with hyphens only"),
  schemaVersion: z.literal("1.0"),
  name: z.string().min(1).max(60),
  description: z.string().max(240).optional(),
  colors: z.object({
    background: hexColor,
    foreground: hexColor,
    primary: hexColor,
    secondary: hexColor,
    success: hexColor,
    warning: hexColor,
    error: hexColor,
    selection: hexColor,
    cursor: hexColor,
  }),
  ansi: ansiPaletteSchema,
  typography: z
    .object({
      family: z.string().min(1).max(80),
      size: z.number().int().min(6).max(72),
    })
    .optional(),
  effects: z
    .object({
      animations: z.boolean(),
    })
    .optional(),
});

export type Theme = z.infer<typeof themeSchema>;

export function parseTheme(input: unknown): Theme {
  return themeSchema.parse(input);
}

export function safeParseTheme(input: unknown): ReturnType<typeof themeSchema.safeParse> {
  return themeSchema.safeParse(input);
}
