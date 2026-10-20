/**
 * Brand tokens, event type colors, and team color tones used by the shell.
 */

import type { EventType } from "@gameplan/types";

export const colors = {
  canvas: "#eef2ef",
  raised: "#f7f9f8",
  paper: "#ffffff",
  inset: "#e4ebe6",
  line: "#c5d0c9",
  ink: "#101412",
  muted: "#5c675f",
  field: "#0a6e38",
  fieldDeep: "#064e28",
  danger: "#c42318",
  dangerDeep: "#9a1c14",
  safety: "#1a8f46",
  safetyDeep: "#146e36",
  caution: "#b58105",
  cautionDeep: "#8c6404",
  link: "#3d8bfd",
} as const;

type Rgb = { r: number; g: number; b: number };

/**
 * Reads a `#RRGGBB` color.
 *
 * @param hex - The color string.
 * @returns The channels, or `undefined` when the string is not a hex color.
 */
export const parseHex = (hex: string | undefined): Rgb | undefined => {
  if (hex === undefined || !/^#[0-9a-fA-F]{6}$/.test(hex)) return undefined;
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
};

/**
 * One color per event type, the same on every team: the stripe on an event
 * row, the dot beside its type, and the calendar's day dots. Fixed rather than
 * team colors, so a type reads the same across teams; each keeps at least 3:1
 * contrast on `inset` and `paper`, and none is the brand green or error red.
 */
export const EVENT_TYPE_COLORS: Readonly<Record<EventType, string>> = {
  practice: "#2563eb",
  game: "#d9480f",
  meeting: "#7c3aed",
  other: "#607080",
};

/**
 * WCAG contrast ratio between two `#RRGGBB` colors.
 *
 * @returns The ratio, 1 to 21; `1` when either is not a hex color.
 */
export const contrastRatio = (left: string, right: string): number => {
  const a = parseHex(left);
  const b = parseHex(right);
  if (a === undefined || b === undefined) return 1;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const luminance = ({ r, g, b }: Rgb): number => {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928
      ? scaled / 12.92
      : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** Text color that stays readable on `hex`. */
export const onColor = (hex: string | undefined): string => {
  const color = parseHex(hex);
  if (color === undefined) return "#ffffff";
  return luminance(color) > 0.25 ? colors.ink : "#ffffff";
};

export type Brand = {
  primary: string;
  onPrimary: string;
  secondary: string;
  accent: string;
  stops: readonly [string, string, ...string[]];
};

const chosen = (hex: string | undefined): string | undefined =>
  parseHex(hex) === undefined ? undefined : hex;

const hexChannel = (value: number): string =>
  value.toString(16).padStart(2, "0");

/** How much of a color `fieldWash` keeps. Higher means more of the color. */
export const fieldWashOpacity = {
  button: 0.75,
  chip: 0.28,
} as const;

/** Draws a fill so the surface behind it shows through a little. */
export const fieldWash = (hex: string, opacity: number): string => {
  const color = parseHex(hex);
  if (color === undefined) return hex;
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${opacity})`;
};

const darken = (hex: string): string => {
  const color = parseHex(hex);
  if (color === undefined) return colors.fieldDeep;
  const channel = (value: number): string =>
    hexChannel(Math.round(value * 0.72));
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
};

/** Keeps a gradient stop from reading as white. */
const offWhite = (hex: string): string => {
  const color = parseHex(hex);
  if (color === undefined || luminance(color) <= 0.85) return hex;
  return darken(hex);
};

/** Pulls a fill slightly toward the muted ink so buttons are less saturated. */
export const muteColor = (hex: string, mute: number = 0.16): string => {
  const color = parseHex(hex);
  const toward = parseHex(colors.muted);
  if (color === undefined || toward === undefined) return hex;
  const amount = mute;
  const mix = (from: number, to: number): number =>
    Math.round(from + (to - from) * amount);
  return `#${hexChannel(mix(color.r, toward.r))}${hexChannel(mix(color.g, toward.g))}${hexChannel(mix(color.b, toward.b))}`;
};

/** Brand colors for the active team. The header gradient uses primary and secondary. */
export const brandColors = (
  theme: { primary?: string; secondary?: string; accent?: string } | undefined,
): Brand => {
  const primary = chosen(theme?.primary) ?? colors.field;
  const secondary = chosen(theme?.secondary) ?? primary;
  const accent = chosen(theme?.accent) ?? secondary;
  const gradient = [
    primary,
    secondary === primary ? darken(primary) : secondary,
  ].map(offWhite) as [string, string, ...string[]];
  return {
    primary,
    onPrimary: onColor(primary),
    secondary,
    accent,
    stops: gradient,
  };
};
