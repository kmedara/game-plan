/**
 * Light, dark, or system color scheme, stored in Capacitor Preferences.
 */

import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import type { PreferencesLike } from './session.service';

/** Preference values for {@link ThemePreferenceService}. */
export const THEME_MODES = ['system', 'light', 'dark'] as const;

/** Saved appearance choice. */
export type ThemeMode = (typeof THEME_MODES)[number];

/** Preferences key for the saved appearance. */
export const THEME_MODE_KEY = 'theme-mode';

/** Store used by {@link ThemePreferenceService}. Tests replace this token. */
export const THEME_PREFERENCES = new InjectionToken<PreferencesLike>('THEME_PREFERENCES', {
  providedIn: 'root',
  // Plain object — Capacitor's Preferences proxy throws if Angular teardown
  // probes `ngOnDestroy` on the plugin object during TestBed cleanup.
  factory: capacitorThemePreferences,
});

/**
 * Capacitor Preferences adapter for theme storage.
 *
 * @returns A plain {@link PreferencesLike} that delegates to Capacitor.
 */
export function capacitorThemePreferences(): PreferencesLike {
  return {
    get: (options) => Preferences.get(options),
    set: (options) => Preferences.set(options),
    remove: (options) => Preferences.remove(options),
  };
}

const COLOR_SCHEME: Record<ThemeMode, string> = {
  system: 'light dark',
  light: 'light',
  dark: 'dark',
};

/**
 * Whether `value` is a stored theme mode.
 *
 * @param value - Raw preference value.
 * @returns True when the value is system, light, or dark.
 */
export const isThemeMode = (value: string | null | undefined): value is ThemeMode =>
  value === 'system' || value === 'light' || value === 'dark';

/**
 * Applies the saved appearance by setting `color-scheme` on the document.
 */
@Injectable({ providedIn: 'root' })
export class ThemePreferenceService {
  private readonly preferences = inject(THEME_PREFERENCES);

  readonly mode = signal<ThemeMode>('system');

  /**
   * Reads the saved mode and applies it. Unknown or missing values follow the system.
   */
  async restore(): Promise<void> {
    try {
      const { value } = await this.preferences.get({ key: THEME_MODE_KEY });
      this.apply(isThemeMode(value) ? value : 'system');
    } catch {
      this.apply('system');
    }
  }

  /**
   * Applies `mode` and stores it.
   *
   * @param mode - System, light, or dark.
   */
  async setMode(mode: ThemeMode): Promise<void> {
    this.apply(mode);
    await this.preferences.set({ key: THEME_MODE_KEY, value: mode });
  }

  /**
   * Sets `color-scheme` so Material `light-dark()` tokens follow `mode`.
   *
   * @param mode - System, light, or dark.
   */
  apply(mode: ThemeMode): void {
    this.mode.set(mode);
    document.documentElement.style.colorScheme = COLOR_SCHEME[mode];
  }
}
