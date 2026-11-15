import type { Theme } from "./schema.js";

/** WCAG 2.x minimum contrast for body text (AA). */
export const WCAG_AA_BODY = 4.5;
/** WCAG 2.x minimum contrast for large text (>=18pt, or >=14pt bold) (AA). */
export const WCAG_AA_LARGE = 3;

/** The theme color roles checked against the theme's own background. */
export const CHECKED_ROLES = [
  "foreground",
  "primary",
  "secondary",
  "success",
  "warning",
  "error",
] as const;

export type CheckedRole = (typeof CHECKED_ROLES)[number];

export interface ContrastResult {
  role: CheckedRole;
  hex: string;
  /** Contrast ratio against the theme background, rounded to 2dp. */
  ratio: number;
  /** Meets WCAG AA for body text (>= 4.5:1). */
  passesBody: boolean;
  /** Meets WCAG AA for large text only (>= 3:1 but < 4.5:1). */
  passesLargeOnly: boolean;
}

/** Parses `#rgb` or `#rrggbb` into 0-255 channels. Returns null for anything else. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  const body = m[1];
  const full =
    body.length === 3
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG 2.x relative luminance of an sRGB color. 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    // WCAG 2.x uses the 0.03928 threshold; keep it verbatim rather than "improving" it.
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.x contrast ratio between two colors, from 1 (identical) to 21 (black on white).
 * Order-independent.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Contrast of every checked role against the theme's own background. */
export function auditThemeContrast(theme: Theme): ContrastResult[] {
  const background = theme.colors.background;
  return CHECKED_ROLES.map((role) => {
    const hex = theme.colors[role];
    const ratio = Math.round(contrastRatio(hex, background) * 100) / 100;
    return {
      role,
      hex,
      ratio,
      passesBody: ratio >= WCAG_AA_BODY,
      passesLargeOnly: ratio >= WCAG_AA_LARGE && ratio < WCAG_AA_BODY,
    };
  });
}
