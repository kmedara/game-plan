/**
 * Applies a team's colors on top of the light and dark theme, and remembers logo URLs.
 */

import { Injectable, inject, signal } from '@angular/core';
import type { TeamTheme } from '@gameplan/types';
import { ApiClientService } from './api-client.service';

/** CSS variables a team theme replaces. */
const TEAM_COLOR_PROPS = [
  '--mat-sys-primary',
  '--mat-sys-on-primary',
  '--mat-sys-primary-container',
  '--mat-sys-on-primary-container',
  '--mat-sys-secondary',
  '--mat-sys-on-secondary',
  '--team-secondary',
] as const;

type TeamColorProp = (typeof TEAM_COLOR_PROPS)[number];

type Rgb = { r: number; g: number; b: number };

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

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

const toHex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`;

const mix = (base: Rgb, toward: Rgb, amount: number): Rgb => ({
  r: base.r + (toward.r - base.r) * amount,
  g: base.g + (toward.g - base.g) * amount,
  b: base.b + (toward.b - base.b) * amount,
});

/**
 * Relative luminance, 0 for black and 1 for white.
 *
 * @param color - The color to measure.
 * @returns A value from 0 to 1.
 */
const luminance = ({ r, g, b }: Rgb): number => {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928
      ? scaled / 12.92
      : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** Text color that stays readable on `color`. */
const onColor = (color: Rgb): string =>
  luminance(color) > 0.4 ? '#171d1c' : '#ffffff';

const pair = (light: string, dark: string): string =>
  `light-dark(${light}, ${dark})`;

/**
 * Light and dark versions of one team color.
 *
 * Pale colors are darkened for light mode. Deep colors are lightened for dark mode.
 *
 * @param color - The stored color.
 * @returns The two tones.
 */
const tone = (color: Rgb): { light: Rgb; dark: Rgb } => ({
  light: luminance(color) > 0.45 ? mix(color, BLACK, 0.35) : color,
  dark: luminance(color) < 0.35 ? mix(color, WHITE, 0.45) : color,
});

/**
 * Material token overrides for a team theme.
 *
 * Primary fills buttons and selected controls. Secondary colors headings and
 * names. Accent tints the primary container. A missing secondary leaves the
 * default secondary tokens in place.
 *
 * @param theme - The stored team theme.
 * @returns CSS custom properties, or `undefined` when the primary is missing.
 */
export const teamColorOverrides = (
  theme: TeamTheme | undefined,
): Partial<Record<TeamColorProp, string>> | undefined => {
  const primary = parseHex(theme?.primary);
  if (primary === undefined) return undefined;
  const primaryTone = tone(primary);
  const accent = parseHex(theme?.accent) ?? primary;
  const lightContainer = mix(primary, WHITE, 0.2);
  const darkContainer = mix(accent, BLACK, 0.62);
  const overrides: Partial<Record<TeamColorProp, string>> = {
    '--mat-sys-primary': pair(
      toHex(primaryTone.light),
      toHex(primaryTone.dark),
    ),
    '--mat-sys-on-primary': pair(
      onColor(primaryTone.light),
      onColor(primaryTone.dark),
    ),
    '--mat-sys-primary-container': pair(
      toHex(lightContainer),
      toHex(darkContainer),
    ),
    '--mat-sys-on-primary-container': pair(
      onColor(lightContainer),
      onColor(darkContainer),
    ),
  };
  const secondary = parseHex(theme?.secondary);
  if (secondary !== undefined) {
    const secondaryTone = tone(secondary);
    const light = toHex(secondaryTone.light);
    const dark = toHex(secondaryTone.dark);
    overrides['--mat-sys-secondary'] = pair(light, dark);
    overrides['--mat-sys-on-secondary'] = pair(
      onColor(secondaryTone.light),
      onColor(secondaryTone.dark),
    );
    overrides['--team-secondary'] = pair(light, dark);
  }
  return overrides;
};

/**
 * Writes or clears the team color tokens on the document.
 *
 * @param theme - The theme to show. Missing or invalid colors restore the app theme.
 */
export const applyTeamColors = (theme: TeamTheme | undefined): void => {
  const root = document.documentElement;
  const overrides = teamColorOverrides(theme);
  for (const prop of TEAM_COLOR_PROPS) {
    const value = overrides?.[prop];
    if (value === undefined) root.style.removeProperty(prop);
    else root.style.setProperty(prop, value);
  }
};

/**
 * Selected team's colors and cached logo download URLs.
 *
 * Call {@link select} or {@link clear} when the active team changes. Pages must
 * not re-apply branding on load. {@link apply} is only for live theme previews
 * (for example team admin settings).
 */
@Injectable({ providedIn: 'root' })
export class TeamBrandService {
  private readonly api = inject(ApiClientService);
  private readonly logos = signal<Record<string, string>>({});
  private readonly loading = new Set<string>();

  /**
   * Makes `teamId` the active team and paints its brand app-wide.
   *
   * @param teamId - The team to keep selected across pages.
   * @param theme - That team's theme, or `undefined` for the default brand.
   */
  async select(teamId: string, theme: TeamTheme | undefined): Promise<void> {
    this.api.setTeamId(teamId);
    await this.apply(theme);
  }

  /** Clears the active team and restores the default brand. */
  async clear(): Promise<void> {
    this.api.setTeamId(undefined);
    await this.apply(undefined);
  }

  /**
   * Paints `theme` without changing the selected team id.
   *
   * Use for admin live previews. Prefer {@link select} when switching teams.
   *
   * @param theme - The theme to show, or `undefined` for the default brand.
   */
  async apply(theme: TeamTheme | undefined): Promise<void> {
    applyTeamColors(theme);
    await this.rememberLogo(theme?.logoKey);
  }

  /**
   * Download URL already presigned for `logoKey`.
   *
   * @param logoKey - The stored object key.
   * @returns The URL, or `undefined` until {@link rememberLogo} finishes.
   */
  logoFor(logoKey: string | undefined): string | undefined {
    if (logoKey === undefined) return undefined;
    return this.logos()[logoKey];
  }

  /**
   * Presigns a logo download once and keeps the URL for later screens.
   *
   * @param logoKey - The stored object key.
   */
  async rememberLogo(logoKey: string | undefined): Promise<void> {
    if (
      logoKey === undefined ||
      this.logos()[logoKey] !== undefined ||
      this.loading.has(logoKey)
    ) {
      return;
    }
    this.loading.add(logoKey);
    try {
      const download = await this.api.presignDownload(logoKey);
      this.logos.update((current) => ({
        ...current,
        [logoKey]: download.downloadUrl,
      }));
    } catch {
      // The team name stays in place when the logo cannot be loaded.
    } finally {
      this.loading.delete(logoKey);
    }
  }
}
