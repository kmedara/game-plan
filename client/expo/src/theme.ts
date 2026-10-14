/**
 * Team color tones used by the shell in place of CSS variables.
 */

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

const luminance = ({ r, g, b }: Rgb): number => {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** Text color that stays readable on `hex`. */
export const onColor = (hex: string | undefined): string => {
  const color = parseHex(hex);
  if (color === undefined) return '#ffffff';
  return luminance(color) > 0.4 ? '#171d1c' : '#ffffff';
};

/** Brand colors for the active team, with a teal fallback. */
export const brandColors = (primary: string | undefined): { primary: string; onPrimary: string } => {
  const parsed = parseHex(primary);
  const color = parsed === undefined ? '#0f766e' : primary!;
  return { primary: color, onPrimary: onColor(color) };
};
