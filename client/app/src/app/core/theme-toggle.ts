/**
 * Compact system / light / dark control.
 */

import { Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { THEME_MODES, ThemePreferenceService, type ThemeMode } from './theme-preference.service';

const LABEL_KEYS: Record<ThemeMode, string> = {
  system: 'theme.system',
  light: 'theme.light',
  dark: 'theme.dark',
};

@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './theme-toggle.html',
})
export class ThemeToggleComponent {
  readonly theme = inject(ThemePreferenceService);
  readonly options = THEME_MODES.map((mode) => ({ mode, labelKey: LABEL_KEYS[mode] }));
}
