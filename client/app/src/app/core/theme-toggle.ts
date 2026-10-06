/**
 * Compact system / light / dark control.
 */

import { Component, inject } from '@angular/core';
import { THEME_MODES, ThemePreferenceService, type ThemeMode } from './theme-preference.service';

const LABELS: Record<ThemeMode, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  templateUrl: './theme-toggle.html',
})
export class ThemeToggleComponent {
  readonly theme = inject(ThemePreferenceService);
  readonly options = THEME_MODES.map((mode) => ({ mode, label: LABELS[mode] }));
}
